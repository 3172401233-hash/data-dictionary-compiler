export function v1Dictionary(overrides = {}) {
  return {
    name: 'orders',
    version: '1.0.0',
    fields: [
      {
        name: 'order_id',
        semanticType: 'id',
        physicalType: 'BIGINT',
        nullable: false,
        description: '订单主键',
      },
      {
        name: 'amount',
        semanticType: 'money',
        physicalType: 'DECIMAL(12,2)',
        unit: 'cent',
        nullable: false,
        default: 0,
      },
      {
        name: 'status',
        semanticType: 'enum',
        physicalType: 'VARCHAR(16)',
        nullable: false,
        enum: ['pending', 'paid', 'cancelled'],
        default: 'pending',
      },
      {
        name: 'contact',
        semanticType: 'text',
        physicalType: 'JSON',
        nullable: true,
        fields: [
          {
            name: 'email',
            semanticType: 'email',
            physicalType: 'varchar(255)',
            nullable: false,
          },
          {
            name: 'phone',
            semanticType: 'phone',
            physicalType: 'varchar(32)',
            nullable: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function v2Dictionary(overrides = {}) {
  return v1Dictionary({
    version: '2.0.0',
    fields: [
      {
        name: 'order_id',
        semanticType: 'id',
        physicalType: 'BIGINT',
        nullable: false,
      },
      {
        name: 'amount',
        semanticType: 'money',
        physicalType: 'DECIMAL(14,2)',
        unit: 'yuan',
        nullable: false,
        default: 0,
      },
      {
        name: 'status',
        semanticType: 'enum',
        physicalType: 'VARCHAR(16)',
        nullable: false,
        enum: ['pending', 'paid', 'cancelled', 'refunded'],
        default: 'pending',
      },
      {
        name: 'contact',
        semanticType: 'text',
        physicalType: 'JSON',
        nullable: true,
        fields: [
          {
            name: 'email',
            semanticType: 'email',
            physicalType: 'varchar(255)',
            nullable: false,
          },
          {
            name: 'phone',
            semanticType: 'phone',
            physicalType: 'varchar(32)',
            nullable: true,
          },
        ],
      },
      {
        name: 'created_at',
        semanticType: 'timestamp',
        physicalType: 'TIMESTAMP',
        nullable: false,
      },
    ],
    ...overrides,
  });
}

export function findByPath(compiled, path) {
  const walk = (fields) => {
    for (const field of fields) {
      if (field.path === path) return field;
      const hit = walk(field.fields);
      if (hit) return hit;
    }
    return null;
  };
  return walk(compiled.fields);
}
