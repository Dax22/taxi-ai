ALTER TABLE account_email_jobs DROP CONSTRAINT account_email_jobs_purpose_check;
ALTER TABLE account_email_jobs ADD CONSTRAINT account_email_jobs_purpose_check CHECK (purpose IN ('verify','reset','changed','welcome'));
