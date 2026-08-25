# Configuración Firebase — Ferco Farma V2

## 1. Authentication

Firebase Console → Authentication → Sign-in method → Email/Password → Enable.

La aplicación utiliza `signInWithEmailAndPassword`.

## 2. Crear el primer administrador

Primero crea el usuario en Authentication.

Después copia el UID y crea en Firestore:

```text
usuarios
└── UID_DEL_ADMIN
    ├── nombre: "Cris"
    ├── email: "correo@..."
    ├── rol: "admin"
    └── activo: true
```

No intentes crear el primer perfil desde la aplicación: las reglas bloquean la autoasignación de roles para evitar que alguien se convierta en administrador.

## 3. Security Rules

Copia el contenido de `firestore.rules` en:

Firebase Console → Firestore Database → Rules

y publica.

También puedes desplegarlo con Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

## 4. Índices

Copia/publica `firestore.indexes.json` o usa:

```bash
firebase deploy --only firestore:indexes
```

## 5. Dominios autorizados

Firebase Console → Authentication → Settings → Authorized domains.

Agrega el dominio que use GitHub Pages, por ejemplo:

```text
TU_USUARIO.github.io
```

Si utilizas un dominio personalizado, agrégalo también.

## 6. Estructura de datos V2

```text
usuarios/{uid}
turnos/{turnoId}
entregas/{entregaId}
tracking_actual/{uid}
tracking_historial/{documentId}
auditoria/{auditId}
configuracion/{configId}
```

## 7. Migración del sistema anterior

El sistema anterior utiliza:

```text
artifacts/ferco-farma-tracker/public/data/entregas_domicilios
```

La V2 no lo mezcla directamente con la nueva estructura porque queremos dejar una separación clara entre datos históricos y datos operativos nuevos.

Antes de migrar, hacer una copia/exportación de la base.

## 8. Regla crítica

No uses:

```text
allow read, write: if true;
```

ni:

```text
allow read, write: if request.auth != null;
```

para toda la base. Eso permitiría a cualquier usuario autenticado acceder a información que no le corresponde.

## 9. Configuración Web

La configuración proporcionada se encuentra en:

```text
js/firebase.js
```

La API key web no es una contraseña; la protección se realiza mediante Authentication, Security Rules y configuración del proyecto.


## Proyecto Firebase activo

Esta versión utiliza exclusivamente el proyecto `domis-6947e`.

### Usuarios ya creados

| UID | Rol | Correo |
|---|---|---|
| `2LkYEVxO8xfcN478mDoHrAdIRYn2` | `domiciliario` | `domi1@fercofarma.com` |
| `Qoo5CixTVYWnOuR9dHYg3qttiHu1` | `domiciliario` | `domi2@fercofarma.com` |
| `UaS0zTuOP5SLrmZEGaZg0rqydbC2` | `admin` | `cris@fercofarma.com` |

Los documentos de Firestore deben existir en `usuarios/{UID}` con, como mínimo, `nombre`, `rol` y `activo: true`. La aplicación no crea perfiles automáticamente.


## 10. Verificación de los perfiles existentes

En la captura proporcionada se observa que el documento `usuarios/2LkYEVxO8xfcN478mDoHrAdIRYn2` contiene `rol: "domiciliario"`, pero el campo `email` visible aparece como `domi2@fercofarma.com`. Esto entra en conflicto con la relación indicada para este UID: `domi1@fercofarma.com`.

**No se debe corregir automáticamente.** Verifica en Authentication cuál correo pertenece realmente a cada UID y luego haz coincidir el campo `email` de Firestore.

Además, los tres perfiles deben tener como mínimo:

```text
nombre: "..."
email: "..."
rol: "admin" | "supervisor" | "domiciliario"
activo: true
```

La aplicación y las reglas necesitan `activo: true` para permitir el acceso.
