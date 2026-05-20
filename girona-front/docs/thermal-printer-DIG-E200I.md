# Térmica Daruma DIG-E200I / prefactura ESC/POS

La **DIG-E200I** es una impresora 80 mm compatible **ESC/POS** (perfil tipo **Epson**), con **Ethernet** (puerto bruto **9100**) y/o USB. Soporta **código QR nativo** vía comandos `GS ( k` (modelo 2).

En Girona, el botón **ESC/POS** del pedido genera bytes en el navegador con la misma secuencia que suelen emitir librerías como `node-thermal-printer` con `PrinterTypes.EPSON` y `printQR()` (no añadimos esa dependencia al front para no duplicar lógica y mantener el puente local opcional).

## Conexión

1. **Red (recomendada en caja):** IP fija o DHCP reservado; el POS usa **TCP al puerto 9100** (RAW).
2. **Puente LAN:** en la PC de la caja, `node scripts/thermal-print-bridge.mjs` (escucha `0.0.0.0:3040`). En Vercel: `NEXT_PUBLIC_THERMAL_BRIDGE_URL=http://IP-LAN-CAJA:3040`. Cualquier tablet/PC de la misma red abre el POS y el navegador llama a esa IP (no `127.0.0.1` salvo que el POS y el puente sean el mismo equipo).
3. **API Next `/api/pos/print/escpos`:** solo permite hosts de red privada o `THERMAL_PRINTER_HOST` explícito.

## QR en el ticket

Definir en el front (build):

```env
NEXT_PUBLIC_THERMAL_PREFACTURA_QR_URL=https://ejemplo.com/pedido/{orderId}
```

También se admite el marcador `{id}`. Si la variable no está, **no se imprime QR** (el resto del ticket igual).

Parámetros por defecto del QR en código: **modelo 2**, **celda 6**, corrección **M** (15 %). Si el QR sale muy pequeño, se puede subir `qrCellSize` hasta **8** vía meta en código (o ampliar después si hace falta opción en UI).

## Ajustes si algo no sale

- **Corte:** el ticket envía `GS V 0` (corte completo). Si la máquina no corta, revisar firmware o probar comando de corte parcial del manual del fabricante.
- **Caracteres:** el texto usa Latin-1 sin tildes; el **payload del QR** va en **UTF-8** (estándar en firmwares recientes).
- **Tamaño QR:** reducir `cellSize` (p. ej. 4) si el papel es angosto o el módulo queda recortado.

## Referencia externa

Para pruebas aisladas en Node, `node-thermal-printer` con `PrinterTypes.EPSON` e `interface: 'tcp://IP:9100'` es una referencia útil; los bytes que genera el proyecto deberían ser equivalentes para texto + QR modelo 2.
