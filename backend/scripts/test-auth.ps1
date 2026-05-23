# Run while backend is on http://localhost:4000
$base = "http://localhost:4000"
$email = "authtest@example.com"
$password = "testpass123"

Write-Host "Health..."
Invoke-RestMethod "$base/health"

Write-Host "Register..."
try {
  $reg = Invoke-RestMethod "$base/auth/register" -Method POST -ContentType "application/json" -Body (@{
    email = $email
    password = $password
    name = "Auth Test"
  } | ConvertTo-Json)
  Write-Host "OK token length:" $reg.token.Length
} catch {
  Write-Host "Register:" $_.Exception.Message
}

Write-Host "Login..."
$login = Invoke-RestMethod "$base/auth/login" -Method POST -ContentType "application/json" -Body (@{
  email = $email
  password = $password
} | ConvertTo-Json)
Write-Host "OK token length:" $login.token.Length

Write-Host "Me..."
$me = Invoke-RestMethod "$base/auth/me" -Headers @{ Authorization = "Bearer $($login.token)" }
Write-Host "User:" $me.user.email

Write-Host "PASS - authentication works"
