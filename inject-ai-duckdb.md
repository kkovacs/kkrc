

## DuckDB SQL (differences from PostgreSQL)

You have `duckdb` cli.

```sql
-- File readers (table functions)
SELECT * FROM read_csv('data.csv', header = true, auto_detect = true);
SELECT * FROM read_parquet('data.parquet');
SELECT * FROM read_json('data.json');
SELECT * FROM read_csv('data/*.csv', union_by_name = true);
INSTALL excel; LOAD excel; SELECT * FROM read_xlsx('report.xlsx', sheet = 'Sheet1');

-- JSON (with JSONPath)
SELECT json_extract('{"a": [1,2]}', '$.a[0]');
SELECT json_array_length(j, ['$.x']) FROM t;
SELECT * FROM json_each('{"arr":[1,2,3]}', '$.arr');

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
SELECT list(name ORDER BY name) FROM t;

-- Friendly SQL
SELECT * EXCLUDE (id, ts) FROM t;
SELECT * REPLACE (upper(name) AS name) FROM t;
SELECT sum(COLUMNS('revenue_.*')) FROM t;
SELECT * FROM t1 UNION ALL BY NAME SELECT * FROM t2;
SELECT grp, count(*) FROM t GROUP BY ALL;
CREATE OR REPLACE TABLE t AS SELECT * FROM src;
INSERT OR REPLACE INTO t BY NAME (a, b) VALUES (1, 2);
PIVOT sales ON year USING sum(revenue);
SELECT max(val, 3) FROM t GROUP BY grp;
SELECT i + 1 AS j, j + 2 AS k FROM range(0, 3) r(i);
SET VARIABLE n = 5; SELECT getvariable('n');
SELECT 'hello'[1:3], [1, 2, 3, 4][-1];
SELECT * FROM events QUALIFY row_number() OVER (PARTITION BY uid ORDER BY ts DESC) = 1;
SELECT * FROM a SEMI JOIN b ON a.id = b.id;
SELECT * FROM trades ASOF JOIN quotes ON trades.ticker = quotes.ticker AND trades.ts >= quotes.ts;
```

Detailed functions documentation: <https://duckdb.org/docs/current/sql/functions/overview>


