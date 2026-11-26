"""Run the official optional Agent Sandbox services for a local FastGPT instance.

Private configuration stays under --state-dir. Existing containers and volumes
are never replaced or removed. This does not start or upgrade Docker itself.
"""
import argparse
import json
import re
import secrets
import socket
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path

IMAGES = {
    'server': 'opensandbox/server:release-1.2.0',
    'proxy': 'ghcr.io/labring/fastgpt-agent-sandbox-proxy:v0.3.0',
    'volume': 'ghcr.io/labring/fastgpt-agent-volume-manager:v0.3.0',
    'runtime': 'ghcr.io/labring/fastgpt-agent-sandbox:v0.3.1',
    'execd': 'opensandbox/execd:release-1.2.0',
    'egress': 'opensandbox/egress:release-1.2.0',
}
LABEL = 'com.yunshu.agent-sandbox'


def docker(*args):
    """Keep command output private; errors expose only the operation name."""
    result = subprocess.run(['docker', *args], capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=900)
    if result.returncode:
        raise RuntimeError('Docker ' + args[0] + ' failed; inspect services.log')
    return result.stdout.strip()


def write_env(path, values):
    """Write simple environment files without printing their credentials."""
    if any('\n' in str(value) or '\r' in str(value) for value in values.values()):
        raise ValueError('Multiline environment values are not supported')
    path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()), encoding='utf-8')


def prepare(args):
    directory = args.state_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'state.json'
    expected = {key: getattr(args, key) for key in
                ('namespace', 'server_port', 'volume_port', 'proxy_port', 'fastgpt_url')}
    if path.exists():
        state = json.loads(path.read_text(encoding='utf-8'))
        if state['settings'] != expected:
            raise ValueError('Existing state has different settings; use its original settings')
    else:
        state = {'settings': expected, 'api_key': secrets.token_hex(32),
                 'proxy_secret': secrets.token_hex(32), 'volume_token': secrets.token_hex(32)}
        path.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    proxy_url = f'http://127.0.0.1:{args.proxy_port}'
    write_env(directory / 'fastgpt.env', {
        'AGENT_SANDBOX_PROVIDER': 'opensandbox',
        'AGENT_SANDBOX_OPENSANDBOX_BASEURL': f'http://127.0.0.1:{args.server_port}',
        'AGENT_SANDBOX_OPENSANDBOX_API_KEY': state['api_key'],
        'AGENT_SANDBOX_OPENSANDBOX_RUNTIME': 'docker',
        'AGENT_SANDBOX_OPENSANDBOX_IMAGE': IMAGES['runtime'],
        'AGENT_SANDBOX_OPENSANDBOX_USE_SERVER_PROXY': 'true',
        'AGENT_SANDBOX_OPENSANDBOX_VOLUME_MANAGER_URL': f'http://127.0.0.1:{args.volume_port}',
        'AGENT_SANDBOX_OPENSANDBOX_VOLUME_MANAGER_TOKEN': state['volume_token'],
        'AGENT_SANDBOX_OPENSANDBOX_VOLUME_NAME_PREFIX': args.namespace,
        'AGENT_SANDBOX_PROXY_SECRET': state['proxy_secret'],
        'AGENT_SANDBOX_PROXY_URL': proxy_url.replace('http:', 'ws:'),
        'AGENT_SANDBOX_PREVIEW_PROXY_URL': proxy_url,
        'AGENT_SANDBOX_CPU_COUNT': '1', 'AGENT_SANDBOX_MEMORY_MIB': '1024',
        'AGENT_SANDBOX_MAX': '4', 'AGENT_SANDBOX_MAX_PER_TEAM': '4',
        'AGENT_SANDBOX_SUSPEND_MINUTES': '15',
    })
    write_env(directory / 'proxy.env', {
        'PORT': '1006', 'AGENT_SANDBOX_PROXY_SECRET': state['proxy_secret'],
        'FASTGPT_APP_URL': args.fastgpt_url,
        'AGENT_SANDBOX_PROXY_REWRITE_HOST': 'host.docker.internal',
        'RUST_LOG': 'warn',
    })
    write_env(directory / 'volume.env', {
        'PORT': '3000', 'VM_RUNTIME': 'docker', 'VM_AUTH_TOKEN': state['volume_token'],
        'VM_LOG_LEVEL': 'info',
    })
    config = f'''[server]
host = "0.0.0.0"
port = 8090
log_level = "WARNING"
api_key = "{state['api_key']}"

[runtime]
type = "docker"
execd_image = "{IMAGES['execd']}"

[egress]
image = "{IMAGES['egress']}"
mode = "dns+nft"
disable_ipv6 = true

[docker]
network_mode = "bridge"
host_ip = "host.docker.internal"
publish_host = "127.0.0.1"
drop_capabilities = ["AUDIT_WRITE", "MKNOD", "NET_ADMIN", "NET_RAW", "SYS_ADMIN", "SYS_MODULE", "SYS_PTRACE", "SYS_TIME", "SYS_TTY_CONFIG"]
no_new_privileges = true
pids_limit = 256

[ingress]
mode = "direct"
'''
    (directory / 'config.toml').write_text(config, encoding='utf-8')
    return directory


def wait_healthy(port):
    """Wait for a public health endpoint without transmitting a credential."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(60):
        try:
            with opener.open(f'http://127.0.0.1:{port}/health', timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(1)
    raise RuntimeError(f'Health check failed on local port {port}')


def run(args):
    """Manage only services carrying this exact namespace ownership label."""
    directory = prepare(args)
    names = [args.namespace + '-' + kind for kind in ('server', 'volume', 'proxy')]
    if args.action == 'status':
        for name in names:
            print(name + ': ' + docker('inspect', '--format', '{{.State.Status}}', name))
        return
    if args.action == 'stop':
        for name in names:
            data = json.loads(docker('inspect', name))[0]
            if data['Config']['Labels'].get(LABEL) != args.namespace:
                raise RuntimeError('Container ownership mismatch')
            docker('stop', name)
        print('Stopped owned control services; sandbox instances and all volumes retained.')
        return
    log_path = directory / 'services.log'
    for image in IMAGES.values():
        exists = subprocess.run(['docker', 'image', 'inspect', image], capture_output=True).returncode == 0
        if not exists:
            print('Pulling official image ' + image, flush=True)
            with log_path.open('a', encoding='utf-8') as log:
                result = subprocess.run(['docker', 'pull', image], stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise RuntimeError('Official image pull failed; inspect services.log')
    network_exists = subprocess.run(['docker', 'network', 'inspect', args.namespace], capture_output=True).returncode == 0
    if not network_exists:
        docker('network', 'create', '--label', LABEL + '=' + args.namespace, args.namespace)
    else:
        network = json.loads(docker('network', 'inspect', args.namespace))[0]
        if network.get('Labels', {}).get(LABEL) != args.namespace:
            raise RuntimeError('Network ownership mismatch')
    for kind, port, container_port, memory in (
            ('server', args.server_port, 8090, '512m'),
            ('volume', args.volume_port, 3000, '192m'),
            ('proxy', args.proxy_port, 1006, '192m')):
        name = args.namespace + '-' + kind
        exists = subprocess.run(['docker', 'container', 'inspect', name], capture_output=True).returncode == 0
        if exists:
            data = json.loads(docker('inspect', name))[0]
            if data['Config']['Labels'].get(LABEL) != args.namespace or data['Config']['Image'] != IMAGES[kind]:
                raise RuntimeError('Existing container ownership or image mismatch')
            if not data['State']['Running']:
                docker('start', name)
        else:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', port))
            command = ['run', '-d', '--name', name, '--label', LABEL + '=' + args.namespace,
                       '--restart', 'unless-stopped', '--network', args.namespace,
                       '--memory', memory, '--cpus', '1', '--pids-limit', '256',
                       '--add-host', 'host.docker.internal:host-gateway',
                       '-p', f'127.0.0.1:{port}:{container_port}']
            if kind == 'server':
                command += ['--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
                            '--mount', f'type=bind,source={directory / "config.toml"},target=/etc/opensandbox/config.toml,readonly',
                            '-e', 'SANDBOX_CONFIG_PATH=/etc/opensandbox/config.toml']
            else:
                command += ['--env-file', str(directory / (kind + '.env'))]
                if kind == 'volume':
                    command += ['--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly']
            command += [IMAGES[kind]]
            docker(*command)
        wait_healthy(port)
        print(name + ': healthy', flush=True)
    print('Merge private fastgpt.env into the app environment, then restart FastGPT.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['up', 'status', 'stop'])
    parser.add_argument('--state-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'local/yunshu-agent-sandbox')
    parser.add_argument('--namespace', default='yunshu-skill')
    parser.add_argument('--server-port', type=int, default=8098)
    parser.add_argument('--volume-port', type=int, default=3015)
    parser.add_argument('--proxy-port', type=int, default=3016)
    parser.add_argument('--fastgpt-url', default='http://host.docker.internal:3040')
    parser.add_argument('--registry', choices=['default', 'cn'], default='default')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,40}', args.namespace):
        parser.error('Namespace must be a short lowercase Docker name')
    if not args.fastgpt_url.startswith(('http://', 'https://')):
        parser.error('FastGPT callback URL must be HTTP or HTTPS')
    if args.registry == 'cn':
        IMAGES = {key: value.replace('opensandbox/', 'sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/', 1)
                  if value.startswith('opensandbox/') else value.replace('ghcr.io/labring/', 'registry.cn-hangzhou.aliyuncs.com/fastgpt/', 1)
                  for key, value in IMAGES.items()}
    run(args)
