# Verificación de usuarios — proyecto `domis-6947e`

Los UID confirmados en Firebase Authentication y sus perfiles Firestore son:

| UID | Email | Rol Firestore |
|---|---|---|
| `2LkYEVxO8xfcN478mDoHrAdIRYn2` | `domi1@fercofarma.com` | `domiciliario1` |
| `Qoo5CixTVYWnOuR9dHYg3qttiHu1` | `domi2@fercofarma.com` | `domiciliario2` |
| `UaS0zTuOP5SLrmZEGaZg0rqydbC2` | `cris@fercofarma.com` | `admin` |

## Importante: tipo de `activo`

En las capturas el valor aparece como texto `"true"`. Lo recomendado es cambiarlo en Firestore a **booleano `true`**, no string.

La V2 tolera temporalmente ambos formatos (`true` y `"true"`) para no bloquear las pruebas, pero los documentos definitivos deberían usar booleano.

## Campos recomendados

Cada perfil puede tener:

```text
email: correo del usuario
rol: domiciliario1 | domiciliario2 | supervisor | admin
activo: true   // booleano
nombre: opcional; si falta, la app usa la parte anterior al @ del correo
```

No es necesario crear otra cuenta ni cambiar los UID. La aplicación vincula Authentication con Firestore mediante el UID del documento.

## Edición de perfiles

En la vista **Usuarios**, un administrador puede pulsar **Editar** en cualquier perfil registrado. El formulario superior se carga con los datos del documento y permite modificar nombre, correo del perfil, rol y estado activo.

El UID queda bloqueado durante la edición para evitar cambiar accidentalmente la identidad del documento. El correo mostrado aquí es el correo del perfil de Firestore; cambiarlo no modifica automáticamente el correo de Firebase Authentication.
