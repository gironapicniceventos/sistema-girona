import * as Icons from "../icons";

export const NAV_DATA = [
  {
    label: "MENU PRINCIPAL",
    items: [
      {
        title: "Panel de control",
        url: "/dashboard",
        icon: Icons.HomeIcon,
      },
      {
        title: "Toma de pedidos",
        url: "/pos",
        icon: Icons.CiShop,
        items: [],
      },
      {
        title: "Menu",
        url: "/menu",
        icon: Icons.MdOutlineRestaurantMenu,
        items: [],
      },
      {
        title: "Inventario",
        url: "/inventory",
        icon: Icons.MdOutlineInventory,
        items: [
          { title: "Inventario general", url: "/inventory" },
          { title: "Inventario Cocina (Picnic)", url: "/inventory/cocina-picnic" },
        ],
      },
      {
        title: "Compras - Proveedores",
        url: "/compras/proveedores",
        icon: Icons.MdOutlineLocalShipping,
        items: [],
      },
      {
        title: "Personal",
        url: "/personnel",
        icon: Icons.MdOutlinePeople,
        items: [],
      },
      {
        title: "Ventas",
        url: "/sales",
        icon: Icons.PieChart,
        items: [],
      },
      {
        title: "Cierre de caja",
        url: "/sales/cash-closing",
        icon: Icons.CashRegisterIcon,
        items: [],
      },
      {
        title: "Calendar",
        url: "/calendar",
        icon: Icons.Calendar,
        items: [],
      },
      {
        title: "Permisos",
        url: "/permissions",
        icon: Icons.Authentication,
        items: [],
      },
    ],
  },
  {
    label: "OTROS",
    items: [
      /* {
        title: "Charts",
        icon: Icons.PieChart,
        items: [
          {
            title: "Basic Chart",
            url: "/charts/basic-chart",
          },
        ],
      },
      {
        title: "UI Elements",
        icon: Icons.FourCircle,
        items: [
          {
            title: "Alerts",
            url: "/ui-elements/alerts",
          },
          {
            title: "Buttons",
            url: "/ui-elements/buttons",
          },
        ],
      }, */
      {
        title: "Autenticación",
        icon: Icons.Authentication,
        items: [
          {
            title: "Salir",
            url: "/auth/sign-in",
          },
        ],
      },
    ],
  },
];
