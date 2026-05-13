"use client";

/** Correos del personal (contraseñas solo en el servidor / seed; no exponer aquí). */
const ROWS: { name: string; email: string; role: string }[] = [
  { name: "Jenny", email: "jenny799@hotmail.com", role: "Dueña" },
  { name: "Jeffer Ortiz", email: "jefferortizm@hotmail.com", role: "Dueño" },
  { name: "Laura Suárez", email: "laurasuarez.girona@gmail.com", role: "Dueña" },
  { name: "Derwin Rodríguez", email: "rodriguezurieles@gmail.com", role: "Dueño (acceso total)" },
  { name: "Alejandra Acevedo", email: "acevedopulido08@gmail.com", role: "Administradora" },
  { name: "Luisa Fernanda", email: "luifernanda2308@gmail.com", role: "Cajera, mesero y compras" },
  { name: "Julio César González", email: "chefjuliogonzales@gmail.com", role: "Gerente operativo" },
  { name: "José Villarreal", email: "jose.villarrela1308@gmail.com", role: "Jefe de cocina" },
  { name: "Yulieth Martínez", email: "yulieth.martinez.jerez21@gmail.com", role: "Caja y mesero" },
  { name: "Catalina", email: "haryucatalina@gmail.com", role: "Mesero" },
  { name: "Elkin Villabona", email: "elkinvillabona1@icloud.com", role: "Mesero" },
  { name: "María José Toloza", email: "majitootoloza13@gmail.com", role: "Mesero" },
  { name: "Mayra de Ávila", email: "mydr0305@gmail.com", role: "Mesero" },
  { name: "Michell Morelli", email: "michellmorelli56@gmail.com", role: "Mesero" },
  { name: "Néstor Suárez", email: "ivansuares69@gmail.com", role: "Mesero" },
  { name: "Angélica Moreno", email: "angemoreno1984@gmail.com", role: "Mesero" },
];

export function StaffLoginReference() {
  return (
    <details className="mt-6 rounded-lg border border-stroke bg-gray-2/80 px-3 py-2 text-left text-xs dark:border-dark-3 dark:bg-dark-2/50">
      <summary className="cursor-pointer select-none font-medium text-dark-4 dark:text-dark-6">
        Cuentas de personal (solo correo)
      </summary>
      <p className="mt-2 text-[11px] leading-snug text-body-color dark:text-dark-6">
        Las claves se entregan por otro canal; no se muestran en esta pantalla por seguridad.
      </p>
      <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1 text-[11px]">
        {ROWS.map((r) => (
          <li key={r.email} className="flex flex-col gap-0.5 border-b border-stroke/60 pb-1.5 last:border-0 dark:border-dark-3/60">
            <span className="font-medium text-dark dark:text-white">{r.name}</span>
            <span className="text-primary">{r.email}</span>
            <span className="text-body-color dark:text-dark-6">{r.role}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
