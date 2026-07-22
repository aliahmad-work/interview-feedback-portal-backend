import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

  const adminPassword = await bcrypt.hash('admin123', 10);
  const interviewer1Password = await bcrypt.hash('interviewer123', 10);
  const interviewer2Password = await bcrypt.hash('interviewer456', 10);

  const adminRole = await prisma.role.create({
    data: { name: 'admin', description: 'Administrator with full access to the system' },
  });

  const interviewerRole = await prisma.role.create({
    data: { name: 'interviewer', description: 'Interviewer who conducts interviews and provides feedback' },
  });

  console.log('Roles created:', { adminRole, interviewerRole });

  const admin = await prisma.user.create({
    data: {
      employeeId: 'EMP001',
      firstname: 'Admin',
      lastname: 'User',
      email: 'admin@example.com',
      password: adminPassword,
      roleId: adminRole.id,
      designation: 'System Administrator',
      phone: '+1234567890',
    },
  });

  const interviewer1 = await prisma.user.create({
    data: {
      employeeId: 'EMP002',
      firstname: 'John',
      lastname: 'Doe',
      email: 'john.doe@example.com',
      password: interviewer1Password,
      roleId: interviewerRole.id,
      designation: 'Senior Interviewer',
      phone: '+1234567891',
    },
  });

  const interviewer2 = await prisma.user.create({
    data: {
      employeeId: 'EMP003',
      firstname: 'Jane',
      lastname: 'Smith',
      email: 'jane.smith@example.com',
      password: interviewer2Password,
      roleId: interviewerRole.id,
      designation: 'Interviewer',
      phone: '+1234567892',
    },
  });

  console.log('Users created:', { admin, interviewer1, interviewer2 });
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
