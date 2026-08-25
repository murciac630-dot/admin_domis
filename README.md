# Ferco Farma — App Unificada V2

Aplicación web única para Ferco Farma con Firebase Authentication + Cloud Firestore + roles.

## Arquitectura

- `index.html`: una sola interfaz.
- `js/firebase.js`: configuración Firebase.
- `js/auth.js`: autenticación y perfiles.
- `js/db.js`: acceso a Firestore.
- `js/app.js`: navegación y módulos por rol.
- `firestore.rules`: seguridad real de Firestore.
- `firestore.indexes.json`: índices necesarios.
- `firebase.json`: configuración de Hosting/Firestore.

## Roles

- `admin`: acceso total.
- `supervisor`: operación, entregas, caja, GPS y nómina.
- `domiciliario`: turno y pedidos propios.

## Importante

El archivo `js/firebase.js` contiene la configuración Web de Firebase proporcionada por el propietario del proyecto. Esta configuración no sustituye las Security Rules.

Las reglas se encuentran en `firestore.rules` y deben publicarse en Firebase.

## Primer acceso

1. En Firebase Console habilita Authentication > Sign-in method > Email/Password.
2. Crea manualmente el primer usuario en Authentication.
3. Copia su UID.
4. En Firestore crea:
   `usuarios/{UID}`
5. Usa como mínimo:

```text
nombre: "Cris"
email: "correo-del-admin"
rol: "admin"
activo: true
```

6. Publica las reglas de `firestore.rules`.
7. Abre la aplicación desde GitHub Pages o Firebase Hosting.
8. Ingresa con el usuario creado.

## Crear nuevos usuarios

Por seguridad, la creación de cuentas de Authentication debe hacerse desde Firebase Console o mediante un backend/Admin SDK. El módulo `Usuarios` de esta primera versión administra el perfil Firestore y sus permisos, pero no crea contraseñas de terceros desde el navegador.

## Migración de datos existentes

La V2 usa colecciones nuevas:

- `usuarios`
- `turnos`
- `entregas`
- `tracking_actual`
- `tracking_historial`
- `auditoria`
- `configuracion`

La colección histórica del sistema anterior (`artifacts/ferco-farma-tracker/public/data/entregas_domicilios`) no se modifica automáticamente. Antes de poner la V2 como producción conviene ejecutar una migración controlada y validar conteos, fechas, pagos y GPS.

## Despliegue GitHub Pages

No requiere Node para ejecutar la app: Firebase Web SDK se carga como módulos desde `gstatic`.

1. Sube todos los archivos manteniendo las carpetas.
2. GitHub → Settings → Pages.
3. Source: Deploy from a branch.
4. Selecciona `main` y `/root`.
5. Guarda.
6. En Firebase Authentication > Settings > Authorized domains agrega el dominio de GitHub Pages si Firebase lo solicita.

## Despliegue Firebase Hosting

Con Firebase CLI:

```bash
firebase login
firebase use domis-6947e
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

## Nota sobre seguridad

Nunca se debe confiar en ocultar botones en la interfaz como mecanismo de seguridad. La autorización efectiva está en `firestore.rules`.


## Firebase actual

Proyecto: `domis-6947e`

La aplicación no usa los nombres de correo como identidad de seguridad: usa el UID de Firebase Authentication. El campo `email` del perfil Firestore es informativo y debe coincidir con Authentication para evitar confusiones.

Usuarios definidos:
- `2LkYEVxO8xfcN478mDoHrAdIRYn2` → `domiciliario` → `domi1@fercofarma.com`
- `Qoo5CixTVYWnOuR9dHYg3qttiHu1` → `domiciliario` → `domi2@fercofarma.com`
- `UaS0zTuOP5SLrmZEGaZg0rqydbC2` → `admin` → `cris@fercofarma.com`

No se utiliza autenticación anónima ni contraseña embebida para administración.
