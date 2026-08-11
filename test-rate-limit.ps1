for ($i=1; $i -le 12; $i++) {
    $response = curl.exe -s -w "`nHTTP %{http_code}`n" -X POST http://localhost:3000/api/v1/auth/telegram -H "Content-Type: application/json" -d '{"initData": "test"}'
    Write-Host "Request $i:"
    Write-Host $response
}