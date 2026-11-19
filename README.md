# TI CONSULTING S.A.S. — Portafolios del equipo

Sitio estático para GitHub Pages con 15 tarjetas de portafolio y un panel de edición en `/editar`.

- **Sitio:** https://darleneelmv.github.io/TI_Consulting/
- **Panel:** https://darleneelmv.github.io/TI_Consulting/editar/

## Cómo se edita (sin código)

1. Entra a `/editar` y escribe la contraseña del equipo.
2. **Portafolios:** toca una tarjeta para cambiar foto, nombre, especialidad, correo, teléfono, datos extra y el **enlace del portafolio** (a dónde lleva la tarjeta). Arrastra para reordenar, agrega o elimina integrantes, u ocúltalos.
3. **Empresa y logo:** logo, nombre, lema, descripción, colores, contacto y redes.
4. Pulsa **Publicar cambios**. El sitio se actualiza en 1–2 minutos.

Si dos personas publican al mismo tiempo, el panel combina los cambios y no se pisan entre sí (a menos que editen a la misma persona).

## Configuración inicial (una sola vez)

La primera vez que se abre `/editar`, el panel pide:

1. Un **token de GitHub** (fine-grained) del dueño del repositorio, con acceso solo a este repositorio y permiso **Contents: Read and write**.
2. La **contraseña del equipo**.

El token se guarda cifrado con esa contraseña (AES-256-GCM, PBKDF2 310 000 iteraciones) en `data/admin.json`. Sin la contraseña no sirve. Usa una contraseña larga: el archivo cifrado es público, igual que todo el repositorio.

Para cambiar la contraseña o renovar el token: pestaña **Acceso** dentro del panel.

## Estructura

```
index.html          Sitio público
css/style.css       Estilos del sitio
js/app.js           Carga data/site.json y pinta las tarjetas
data/site.json      Todos los datos editables (empresa + integrantes)
data/admin.json     Token cifrado (lo crea el panel)
assets/             Logo e imágenes subidas desde el panel
editar/             Panel de administración
```
