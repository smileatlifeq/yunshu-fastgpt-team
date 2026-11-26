export type YunshuNavigationItem = {
  label: string;
  icon: string;
  activeIcon: string;
  link: string;
  activeLink: string[];
  activePrefix?: string[];
  unread?: number;
};

/** 原生侧边栏共用的 root 账号入口；隐藏菜单不替代后台 root 鉴权。 */
export const yunshuAccountNavigation = (username?: string): YunshuNavigationItem[] =>
  username === 'root'
    ? [
        {
          label: '账号管理',
          icon: 'navbar/userLight',
          activeIcon: 'navbar/userFill',
          link: '/yunshu',
          activeLink: ['/yunshu'],
          activePrefix: [] as string[],
          unread: 0
        }
      ]
    : [];
