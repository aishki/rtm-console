-- Runs once, when the local container's data volume is first created.
-- The integration tests use rtm_console_test, so they never touch the database you develop against.
CREATE DATABASE rtm_console_test;
