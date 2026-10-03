-- Runs once when the local Postgres volume is first created.
-- Creates a separate database for integration tests so test runs never
-- wipe the data you are using in the local app.
CREATE DATABASE checkout_test;
