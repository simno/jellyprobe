// Validation middleware factory. Pass schemas keyed by request part — body,
// query, params — and the parsed/coerced values replace req[part]. On failure
// returns 400 with a structured field list so clients can highlight inputs.
function validate(schemas) {
  return (req, res, next) => {
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }));
        return res.status(400).json({ error: 'Validation failed', issues });
      }
      // zod coerces and strips unknowns; replace so handlers see clean values.
      req[part] = result.data;
    }
    next();
  };
}

module.exports = validate;
