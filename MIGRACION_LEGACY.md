# Migración de datos del sistema anterior

La V2 no migra datos automáticamente para evitar modificar o duplicar información financiera.

Origen identificado en las aplicaciones anteriores:

```text
artifacts/domis-6947e-tracker/public/data/entregas_domicilios
```

La migración recomendada debe:

1. Exportar una copia de la colección anterior.
2. Normalizar `timestamp` a un único formato.
3. Mapear `domiciliario` (nombre) → `usuarioId` (UID).
4. Mapear `pagoDesglosados` → `pago.medios`.
5. Mantener `lat` y `lng`.
6. Mantener `empresa`.
7. Crear `turnos` históricos solo cuando exista información suficiente.
8. Guardar un campo `legacyId` con el ID original.
9. Validar:
   - número de registros
   - suma total recaudada
   - suma por medio de pago
   - fechas mínima/máxima
   - cantidad por domiciliario
10. Solo después habilitar la V2 para producción.

No elimines la colección anterior hasta terminar la conciliación.
