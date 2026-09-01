<?php

declare(strict_types=1);

$fixture = json_decode(
    file_get_contents(__DIR__ . '/woocommerce-hmac-v1.json'),
    true,
    512,
    JSON_THROW_ON_ERROR
);

$bodyHash = hash('sha256', $fixture['raw_body']);
$canonical = implode("\n", [
    $fixture['merchant_id'],
    $fixture['installation_id'],
    (string) $fixture['timestamp'],
    $fixture['nonce'],
    strtoupper($fixture['method']),
    $fixture['path'],
    $bodyHash,
]);
$signature = hash_hmac('sha256', $canonical, $fixture['secret']);

if (!hash_equals($fixture['body_sha256'], $bodyHash) || !hash_equals($fixture['signature'], $signature)) {
    throw new RuntimeException('WooCommerce HMAC v1 fixture mismatch');
}
