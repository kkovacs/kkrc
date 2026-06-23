

## DuckDB SQL (differences from PostgreSQL)

You have `duckdb` cli.

```sql
-- File readers (table functions)
SELECT * FROM read_csv('data.csv', header = true, auto_detect = true);
SELECT * FROM read_parquet('data.parquet');
SELECT * FROM read_json('data.json');

-- Attach/query other DBs (SQLite, Postgres, etc.)
ATTACH 'file.sqlite' AS other_db (READ_ONLY);
ATTACH 'postgres_db' AS other_db (TYPE POSTGRES, READ_ONLY);
SELECT * FROM other_db.users;
SELECT * FROM other_db.otherschema.users;
SELECT a.*, b.* FROM db1.tbl a JOIN db2.tbl b ON a.id = b.id;
INSERT INTO cloud_db.analytics.events SELECT * FROM other_db.public.events;

-- Metadata
DESCRIBE my_table;
SUMMARIZE my_table;
SELECT database_name, schema_name, table_name FROM duckdb_tables();
SELECT column_name, data_type FROM duckdb_columns() WHERE table_name = 'my_table';
SELECT function_name FROM duckdb_functions() WHERE function_name LIKE '%json%';

-- Functions
SELECT printf('Name: %s, Percent: %d%%', 'Alice', 30);
SELECT last_day(DATE '2024-02-01');
SELECT date_add(DATE '2024-01-01', INTERVAL 1 MONTH);
SELECT DATE '2024-12-31' - DATE '2024-01-01';
SELECT unnest(generate_series(DATE '2024-01-01', DATE '2024-12-31', INTERVAL 1 MONTH));
SELECT epoch_ms(1705312800000);
SELECT epoch(TIMESTAMP '2024-01-15');
SELECT dayname(DATE '2024-06-15');
SELECT time_bucket(INTERVAL '1 hour', TIMESTAMP '2024-06-15');
SELECT strftime(NOW(), '%Y-%m-%d %H:%M');
SELECT strptime('2024-01-15', '%Y-%m-%d')::DATE;

-- JSON (with JSONPath)
SELECT json_extract('{"a": [1,2]}', '$.a[0]');
SELECT json_array_length(j, ['$.x']) FROM t;
SELECT * FROM json_each('{"arr":[1,2,3]}', '$.arr');

-- Aggregates
SELECT list(name ORDER BY name) FROM t;

-- DuckDB-specific: QUALIFY, FILL, SEMI/ANTI/ASOF/POSITIONAL joins
SELECT * FROM events QUALIFY row_number() OVER (PARTITION BY user_id ORDER BY ts DESC) = 1;
SELECT ts, FILL(temp) OVER (ORDER BY ts) FROM readings;
SELECT * FROM a SEMI JOIN b ON a.id = b.id;
SELECT * FROM a ANTI JOIN b ON a.id = b.id;
SELECT * FROM trades ASOF JOIN quotes ON trades.ticker = quotes.ticker AND trades.ts >= quotes.ts;
SELECT * FROM a POSITIONAL JOIN b;

-- Extensions
INSTALL httpfs;
LOAD httpfs;
```

Detailed functions documentation: <https://duckdb.org/docs/current/sql/functions/overview>
