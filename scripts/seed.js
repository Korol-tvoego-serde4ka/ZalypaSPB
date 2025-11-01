require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient, Role } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const password = 'demo';
  const passwordHash = await bcrypt.hash(password, 10);

  // Users
  const user = await prisma.user.upsert({
    where: { username: 'testuser' },
    update: {},
    create: { username: 'testuser', email: 'user@zalypa.com', passwordHash, role: Role.User },
  });
  const reseller = await prisma.user.upsert({
    where: { username: 'testreseller' },
    update: {},
    create: { username: 'testreseller', email: 'reseller@zalypa.com', passwordHash, role: Role.Reseller },
  });
  const admin = await prisma.user.upsert({
    where: { username: 'testadmin' },
    update: {},
    create: { username: 'testadmin', email: 'admin@zalypa.com', passwordHash, role: Role.Admin },
  });

  // Reseller balance
  await prisma.resellerBalance.upsert({
    where: { resellerId: reseller.id },
    update: { balanceCents: 1000000 },
    create: { resellerId: reseller.id, balanceCents: 1000000 },
  });

  // Products
  const products = [
    { name: 'Premium Key', priceCents: 500000, defaultDurationDays: 30, enabled: true },
    { name: 'Basic Key', priceCents: 200000, defaultDurationDays: 30, enabled: true },
    { name: 'Enterprise Key', priceCents: 1500000, defaultDurationDays: 30, enabled: true },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { name: p.name }, update: {}, create: p });
  }

  // Loader release
  await prisma.loaderRelease.upsert({
    where: { version: '1.0.0' },
    update: {},
    create: { version: '1.0.0', filePath: '/downloads/loader-v1.exe', checksum: 'dev' },
  });

  console.log('Seed completed:', { user: user.username, reseller: reseller.username, admin: admin.username });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
