
## You have DuckDB

You have `duckdb` installed, you can use it for all kinds of database operations, for working with JSON, CSV, .parquet files and to access PostgreSQL, MySQL, SQLite databases.

You can run duckdb from bash, using a tmp DB to persist tables: `duckdb -list tmp.ddb -c "ATTACH ... (READ_ONLY); SELECT ... LIMIT 10;"`

Always use either the `-list` or `-jsonlines` output formats and SQL `LIMIT` to minimize AI context!

DuckDB uses a PostgreSQL-compatible SQL dialect, but has its own extensions:

```sql
-- Reading files
SELECT * FROM read_csv('data.csv', header = true, auto_detect = true);
SELECT * FROM read_parquet('data.parquet');
SELECT * FROM read_json('data.json');

-- DuckDB can query across multiple attached databases simultaneously.
-- Each database has its own catalog of schemas and tables.
ATTACH 'file.sqlite' AS other_db (READ_ONLY);
ATTACH 'postgres_db' AS other_db (TYPE POSTGRES, READ_ONLY); -- PostgreSQL

-- Fully qualified name: database.table or database.schema.table
SELECT * FROM other_db.users;
SELECT * FROM other_db.otherschema.users;

-- Cross-database queries
SELECT a.*, b.* FROM db1.tbl a JOIN db2.tbl b ON a.id = b.id;

-- Copy between databases
INSERT INTO cloud_db.analytics.events SELECT * FROM other_db.public.events;

-- Table/column metadata
SELECT database_name, schema_name, table_name, estimated_size FROM duckdb_tables();
SELECT column_name, data_type, is_nullable, column_default FROM duckdb_columns() WHERE table_name = 'my_table';

-- Function search
SELECT function_name, parameters, return_type FROM duckdb_functions() WHERE function_name LIKE '%json%';

-- Show table schema
DESCRIBE my_table;

-- Quick stats (min, max, nulls, distinct)
SUMMARIZE my_table;

-- printf format specifiers: %s (string), %d (int), %f (float), %% (literal %)
SELECT printf('Name: %s, Age: %d, Score: %.1f', 'Alice', 30, 95.5);

-- Additional date/time functions
SELECT last_day(DATE '2024-02-01');
SELECT date_add(DATE '2024-01-01', INTERVAL 1 MONTH);
SELECT DATE '2024-12-31' - DATE '2024-01-01'; -- 365 days

-- Generate date series
SELECT unnest(generate_series(DATE '2024-01-01', DATE '2024-12-31', INTERVAL 1 MONTH));

-- Epoch conversions
SELECT epoch_ms(1705312800000);              -- ms to timestamp
SELECT epoch(TIMESTAMP '2024-01-15 10:00:00'); -- timestamp to epoch seconds

-- Extraction
SELECT date_part('year', DATE '2024-06-15');
SELECT extract(month FROM TIMESTAMP '2024-06-15');
SELECT dayname(DATE '2024-06-15');

-- Truncation & bucketing
SELECT date_trunc('month', TIMESTAMP '2024-06-15 10:30:00');
SELECT time_bucket(INTERVAL '1 hour', TIMESTAMP '2024-06-15 10:35:00');

-- Formatting & parsing
SELECT strftime(NOW(), '%Y-%m-%d %H:%M');
SELECT strptime('2024-01-15', '%Y-%m-%d')::DATE;

-- JSON functions with JSONPath
SELECT json_extract('{"duck.goose": [1, 2, 3]}', '$."duck.goose"[1]');
SELECT json_array_length(j, ['$.species']) FROM example;
SELECT je.*, je.rowid FROM example AS e, json_each(e.j, '$.species') AS je;

-- String & list aggregation
SELECT string_agg(name, ', ' ORDER BY name) FROM t;
SELECT list(name ORDER BY name) FROM t;

-- Row numbering, ranking
SELECT *, row_number() OVER (ORDER BY score DESC) AS rn FROM t;
SELECT *, rank() OVER (ORDER BY score DESC) FROM t;
SELECT *, dense_rank() OVER (ORDER BY score DESC) FROM t;
SELECT *, ntile(4) OVER (ORDER BY score) AS quartile FROM t;

-- Lead/Lag (access adjacent rows)
SELECT *, lag(val) OVER (ORDER BY date) AS prev_val FROM t;
SELECT *, lead(val, 2, 0) OVER (ORDER BY date) AS val_2ahead FROM t;

-- First/Last value
SELECT *, first_value(val) OVER w, last_value(val) OVER w FROM t WINDOW w AS (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING);

-- Named windows (reuse window definitions)
SELECT *, sum(val) OVER w, avg(val) OVER w FROM t WINDOW w AS (PARTITION BY group_col ORDER BY date);

-- Deduplicate rows (keep latest per group)
SELECT * FROM events QUALIFY row_number() OVER (PARTITION BY user_id ORDER BY ts DESC) = 1;

-- FILL: forward-fill NULL gaps in time series. Fills NULL values with the last non-NULL value in window order
SELECT ts, FILL(temperature) OVER (ORDER BY ts) FROM readings;

-- QUALIFY: filter on window results
SELECT * FROM t QUALIFY row_number() OVER ( PARTITION BY group_col ORDER BY score DESC) = 1;

-- FILL: gap-filling window function (v1.4+)
SELECT ts, FILL(value) OVER (ORDER BY ts) FROM sensor_data;

-- SEMI JOIN (rows from left that have a match)
SELECT * FROM a SEMI JOIN b ON a.id = b.id;

-- ANTI JOIN (rows from left with NO match)
SELECT * FROM a ANTI JOIN b ON a.id = b.id;

-- LATERAL JOIN (subquery refs preceding tables)
SELECT * FROM a, LATERAL (SELECT * FROM b WHERE b.a_id = a.id LIMIT 3);

-- ASOF JOIN (match nearest value)
SELECT * FROM trades ASOF JOIN quotes ON trades.ticker = quotes.ticker AND trades.ts >= quotes.ts;

-- POSITIONAL JOIN (by row position)
SELECT * FROM a POSITIONAL JOIN b;

-- Query plan with execution stats
EXPLAIN ANALYZE SELECT * FROM t WHERE id > 100;

-- Extension lifecycle:
-- INSTALL downloads the extension binary
-- LOAD makes it available in the current session
-- Some extensions are auto-loaded when their functions are used (json, parquet)

-- Commonly used extensions:
-- httpfs     — HTTP/S3/GCS remote file access
-- json       — JSON functions (auto-loaded)
-- parquet    — Parquet read/write (built-in, always available)
-- spatial    — ST_* geospatial functions, GDAL I/O
-- icu        — Unicode collation, locale-aware date formatting
-- excel      — Read .xlsx files with read_xlsx()
-- delta      — Read Delta Lake tables with delta_scan()
-- iceberg    — Read Apache Iceberg tables with iceberg_scan()
-- h3         — Uber's H3 hexagonal grid system
-- aws        — AWS credential management
-- azure      — Azure Blob Storage access
-- sqlite     — Attach and query SQLite databases
-- postgres   — Attach and query PostgreSQL databases
-- mysql      — Attach and query MySQL databases
```

Detailed DuckDB functions documentation:

- [Aggregate functions that combine multiple values into a single result](https://duckdb.org/docs/sql/functions/aggregates)
- [Operations on fixed-size arrays](https://duckdb.org/docs/sql/functions/array)
- [Manipulate bits in integer values](https://duckdb.org/docs/sql/functions/bitwise)
- [Functions for Binary Large Objects](https://duckdb.org/docs/sql/functions/blob)
- [Character-specific operations](https://duckdb.org/docs/sql/functions/char)
- [Calendar date manipulations](https://duckdb.org/docs/sql/functions/date)
- [Utilities for Enumeration types](https://duckdb.org/docs/sql/functions/enum)
- [Parse and query JSON data](https://duckdb.org/docs/sql/functions/json)
- [Operations on dynamic lists/sequences](https://duckdb.org/docs/sql/functions/list)
- [Creating and querying key-value maps](https://duckdb.org/docs/sql/functions/map)
- [Mathematical operations (power, rounding, etc.)](https://duckdb.org/docs/sql/functions/numeric)
- [Text manipulation (substring, regex, etc.)](https://duckdb.org/docs/sql/functions/string)
- [Operations on nested structured data](https://duckdb.org/docs/sql/functions/struct)
- [Clock time manipulations](https://duckdb.org/docs/sql/functions/time)
- [Combined date and time operations](https://duckdb.org/docs/sql/functions/timestamp)
- [Operations on Union types](https://duckdb.org/docs/sql/functions/union)
- [System information and helper functions](https://duckdb.org/docs/sql/functions/utility)
- [Functions that return an entire table (e.g., range, read\_csv)](https://duckdb.org/docs/sql/functions/tablefunctions)
- [Perform calculations across a set of table rows related to the current row](https://duckdb.org/docs/sql/functions/window_functions)

