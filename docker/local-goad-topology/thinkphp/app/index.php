<?php
$routes = [
    'Office / Ops' => '10.80.20.0/24 via 10.80.10.20',
    'Core Services' => '10.80.30.0/24 via 10.80.10.20',
];
$services = [
    ['zone' => 'Office', 'name' => 'intranet', 'address' => '10.80.20.10', 'ports' => '80/tcp', 'role' => 'Internal Nginx portal'],
    ['zone' => 'Office', 'name' => 'git01', 'address' => '10.80.20.20', 'ports' => '3000/tcp, 22/tcp', 'role' => 'Gitea code hosting'],
    ['zone' => 'Office', 'name' => 'mail01', 'address' => '10.80.20.30', 'ports' => '1025/tcp, 8025/tcp', 'role' => 'SMTP test mailbox'],
    ['zone' => 'Office', 'name' => 'dev01', 'address' => '10.80.20.50', 'ports' => '22/tcp', 'role' => 'Linux developer workstation'],
    ['zone' => 'Core', 'name' => 'ldap01', 'address' => '10.80.30.10', 'ports' => '389/tcp, 636/tcp', 'role' => 'OpenLDAP directory'],
    ['zone' => 'Core', 'name' => 'db01', 'address' => '10.80.30.20', 'ports' => '3306/tcp', 'role' => 'MariaDB application database'],
    ['zone' => 'Core', 'name' => 'cache01', 'address' => '10.80.30.30', 'ports' => '6379/tcp', 'role' => 'Redis cache'],
    ['zone' => 'Core', 'name' => 'files01', 'address' => '10.80.30.40', 'ports' => '445/tcp, 139/tcp', 'role' => 'Samba file shares'],
    ['zone' => 'Core', 'name' => 'minio01', 'address' => '10.80.30.50', 'ports' => '9000/tcp, 9001/tcp', 'role' => 'S3-compatible object storage'],
    ['zone' => 'Core', 'name' => 'dns01', 'address' => '10.80.30.53', 'ports' => '53/tcp, 53/udp', 'role' => 'CoreDNS corp.local zone'],
];
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ThinkPHP Entry - Linux Enterprise Lab</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Arial, sans-serif; margin: 40px; color: #17202a; background: #f7f9fb; }
    main { max-width: 1120px; }
    code { background: #eef1f4; padding: 2px 6px; border-radius: 4px; }
    table { border-collapse: collapse; margin-top: 18px; width: 100%; background: #fff; }
    th, td { border: 1px solid #c9d1d9; padding: 8px 12px; text-align: left; }
    th { background: #edf2f7; }
    .pill { display: inline-block; min-width: 72px; padding: 2px 8px; border-radius: 999px; background: #e8f4ff; color: #0b5793; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>ThinkPHP Entry Node</h1>
    <p>This container is the DMZ entry point for the Docker Linux enterprise lab.</p>
    <h2>Routes</h2>
    <table>
      <tr><th>Segment</th><th>Route</th></tr>
      <?php foreach ($routes as $name => $route): ?>
        <tr><td><?= htmlspecialchars($name) ?></td><td><code><?= htmlspecialchars($route) ?></code></td></tr>
      <?php endforeach; ?>
    </table>
    <h2>Internal Services</h2>
    <table>
      <tr><th>Zone</th><th>Name</th><th>Address</th><th>Ports</th><th>Role</th></tr>
      <?php foreach ($services as $service): ?>
        <tr>
          <td><span class="pill"><?= htmlspecialchars($service['zone']) ?></span></td>
          <td><?= htmlspecialchars($service['name']) ?></td>
          <td><code><?= htmlspecialchars($service['address']) ?></code></td>
          <td><code><?= htmlspecialchars($service['ports']) ?></code></td>
          <td><?= htmlspecialchars($service['role']) ?></td>
        </tr>
      <?php endforeach; ?>
    </table>
  </main>
</body>
</html>
