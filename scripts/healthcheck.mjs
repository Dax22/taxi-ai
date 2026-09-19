try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health/ready`, { signal: AbortSignal.timeout(3000) });
  if (response.status !== 200 || (await response.json()).status !== 'ready') process.exitCode = 1;
} catch { process.exitCode = 1; }
