# Contabilidad Personal (web app para iPhone)

App instalable en la pantalla de inicio del iPhone (PWA). Funciona sin conexión y guarda los datos en un archivo `contabilidad-personal.json` en Google Drive que comparten los dos móviles.

## Pantallas

- **Mes** (toma de datos): ingresos del mes, partidas de *Necesidades*, *Estilo de vida* y *Ahorro* con su objetivo (% de los ingresos) frente al gasto real, y la lista de movimientos. El botón **+** sirve para apuntar un gasto o una aportación al ahorro.
- **Dashboard**: anillos de tasa de ahorro, presupuesto gastado y dinero disponible; indicadores de riesgo con semáforo; comparación de objetivo y real por grupo y por partida; evolución a 12 meses de cualquier concepto, y ahorro acumulado.
- **Histórico**: acumulado total (ingresos, gastos, ahorro, balance, tasa media y desviación por partida) y la lista de meses anteriores. Al tocar un mes se abre.
- **Ajustes**: tu nombre en este móvil, la conexión con Google Drive y con quién se comparte, partidas y porcentajes (con plantillas 50/30/20, 50/20/30 y 60/20/20), y exportación e importación en JSON o CSV.

### Indicadores de riesgo
| Indicador | Verde | Ámbar | Rojo |
|---|---|---|---|
| Tasa de ahorro | ≥ 20 % | 10–20 % | < 10 % |
| Peso de necesidades | ≤ 50 % | 50–60 % | > 60 % |
| Proyección fin de mes (gasto ÷ presupuesto) | ≤ 100 % | ≤ 110 % | > 110 % |
| Partidas excedidas | 0 | 1–2 | ≥ 3 |
| Colchón de emergencia (meses de gastos básicos) | ≥ 6 | 3–6 | < 3 |
| Balance del mes | ≥ 0 | hasta −5 % | peor |
| Tendencia del gasto (3 últimos meses frente a los 3 anteriores) | ≤ +5 % | ≤ +15 % | > +15 % |

El colchón de emergencia suma todo lo apuntado en las partidas cuyo nombre contiene «emergencia».

---

## Puesta en marcha (una sola vez, unos 20 minutos)

### 1. Publicar la app (GitHub Pages, gratis)
1. Crea una cuenta en github.com y un repositorio **público**, por ejemplo `contabilidad`.
2. Sube todos los archivos de esta carpeta (botón *Add file → Upload files*; arrastra las carpetas `css`, `js` e `icons`, y además `index.html`, `manifest.webmanifest` y `sw.js`).
3. En el repositorio, ve a *Settings → Pages → Source: Deploy from a branch → main / (root)* y pulsa *Save*.
4. En un par de minutos la app estará en `https://TU-USUARIO.github.io/contabilidad/`.

> El código es público, pero los datos no: viven en tu Google Drive y en cada móvil.

### 2. Crear las credenciales de Google (para Drive)
1. Entra en https://console.cloud.google.com, crea un proyecto llamado «Contabilidad».
2. *APIs y servicios → Biblioteca*: busca **Google Drive API** y pulsa **Habilitar**.
3. *APIs y servicios → Pantalla de consentimiento de OAuth* (o *Google Auth Platform*):
   - Tipo de usuario: **Externo**. Nombre de la app: Contabilidad. Pon tu email de soporte.
   - En **Usuarios de prueba** añade **las dos cuentas de Google** (la tuya y la de tu pareja).
   - Déjala en modo **Prueba**. No hace falta publicarla.
4. *Credenciales → Crear credenciales → ID de cliente de OAuth*:
   - Tipo: **Aplicación web**.
   - Orígenes de JavaScript autorizados: `https://TU-USUARIO.github.io`
   - URI de redireccionamiento autorizados: `https://TU-USUARIO.github.io/contabilidad/` (con la barra final; es exactamente lo que muestra la app en *Ajustes → Configuración técnica*).
5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pégalo en `js/config.js` antes de subir los archivos. También puedes pegarlo en la app, en *Ajustes → Configuración técnica*.

### 3. Instalar en cada iPhone
1. Abre la URL en **Safari**, pulsa Compartir y luego **Añadir a pantalla de inicio**.
2. Abre la app desde el icono y ve a *Ajustes*: escribe tu nombre y pulsa **Conectar con Google**.
3. Google avisará de que la app no está verificada: pulsa *Continuar*. Es tu propia app en modo prueba.

### 4. Compartir entre los dos móviles
1. En el **primer** iPhone: conecta con Google, configura los ingresos y las partidas y pulsa *Sincronizar ahora*. Se crea `contabilidad-personal.json` en tu Drive.
2. En *Ajustes → Compartir con la otra persona*, escribe el Gmail de tu pareja y pulsa **Compartir**.
3. En el **segundo** iPhone: instala la app y conecta con su cuenta de Google. La app encuentra sola el archivo compartido y descarga los datos.

A partir de ahí, cada cambio se guarda al instante en el móvil y se sube a Drive a los pocos segundos. Al abrir la app se descargan los cambios del otro. Si los dos editáis a la vez, los cambios se combinan movimiento a movimiento y nunca se pierden apuntes.

---

## Notas
- **Sesión de Google**: el permiso de Google dura 1 hora. Al abrir la app pasada esa hora, se renueva sola con un salto rápido a Google. Si Google pide confirmar, el indicador de arriba mostrará «Reconectar».
- **Sin conexión**: puedes apuntar gastos igualmente; se sincronizan al recuperar la red.
- **Copias de seguridad**: además de Drive (que guarda el historial de versiones del archivo), puedes exportar una copia JSON desde Ajustes.
- **Actualizar la app**: sube los archivos modificados a GitHub y cambia `VERSION` en `sw.js` (por ejemplo, `cp-v2`).
- **Permisos**: la app pide acceso a Drive completo para poder abrir el archivo que te comparte la otra persona. Solo lee y escribe `contabilidad-personal.json`.

## Probar en el ordenador
```
python -m http.server 8765
```
y abre http://localhost:8765. Para probar Drive en local, añade `http://localhost:8765` como origen y `http://localhost:8765/` como URI de redirección en Google Cloud.
