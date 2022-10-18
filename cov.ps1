cls
deno test --fail-fast --coverage=coverage --unstable --allow-env --allow-net
deno coverage --unstable coverage
rm coverage/*
