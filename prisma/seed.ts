import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  await prisma.interviewFeedback.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.jobPositions.deleteMany();
  await prisma.department.deleteMany();
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

  // Create Departments
  const engineeringDept = await prisma.department.create({
    data: {
      name: 'Engineering',
      description: 'Software development and engineering team',
    },
  });

  const productDept = await prisma.department.create({
    data: {
      name: 'Product',
      description: 'Product management and design team',
    },
  });

  console.log('Departments created:', { engineeringDept, productDept });

  // Create Job Positions
  const seniorDevPosition = await prisma.jobPositions.create({
    data: {
      title: 'Senior Software Engineer',
      requiredSkills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'AWS'],
      minimumExperience: 5,
      maximumExperience: 8,
      description: 'Senior role responsible for designing and implementing complex software solutions',
      status: 'open',
      departmentId: engineeringDept.id,
      createdBy: admin.id,
    },
  });

  const frontendDevPosition = await prisma.jobPositions.create({
    data: {
      title: 'Frontend Developer',
      requiredSkills: ['React', 'TypeScript', 'CSS', 'HTML', 'Redux'],
      minimumExperience: 2,
      maximumExperience: 4,
      description: 'Frontend developer responsible for building user interfaces',
      status: 'open',
      departmentId: engineeringDept.id,
      createdBy: admin.id,
    },
  });

  const backendDevPosition = await prisma.jobPositions.create({
    data: {
      title: 'Backend Developer',
      requiredSkills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis', 'Docker'],
      minimumExperience: 3,
      maximumExperience: 6,
      description: 'Backend developer responsible for server-side logic and APIs',
      status: 'open',
      departmentId: engineeringDept.id,
      createdBy: admin.id,
    },
  });

  const productManagerPosition = await prisma.jobPositions.create({
    data: {
      title: 'Product Manager',
      requiredSkills: ['Agile', 'Scrum', 'Product Strategy', 'User Research', 'Data Analysis'],
      minimumExperience: 4,
      maximumExperience: 7,
      description: 'Product manager responsible for product roadmap and strategy',
      status: 'open',
      departmentId: productDept.id,
      createdBy: admin.id,
    },
  });

  console.log('Job Positions created:', {
    seniorDevPosition,
    frontendDevPosition,
    backendDevPosition,
    productManagerPosition,
  });

  // Create Candidates
  const candidates = [];
  const candidateNames = [
    { first: 'Michael', last: 'Johnson' },
    { first: 'Emily', last: 'Williams' },
    { first: 'David', last: 'Brown' },
    { first: 'Sarah', last: 'Davis' },
    { first: 'James', last: 'Miller' },
    { first: 'Jennifer', last: 'Wilson' },
    { first: 'Robert', last: 'Moore' },
    { first: 'Lisa', last: 'Taylor' },
    { first: 'William', last: 'Anderson' },
    { first: 'Amanda', last: 'Thomas' },
  ];

  for (let i = 0; i < candidateNames.length; i++) {
    const candidate = await prisma.candidate.create({
      data: {
        candidateCode: `CAND${String(i + 1).padStart(4, '0')}`,
        firstname: candidateNames[i].first,
        lastname: candidateNames[i].last,
        email: `${candidateNames[i].first.toLowerCase()}.${candidateNames[i].last.toLowerCase()}@candidate.com`,
        phone: `+1234567${String(i + 1).padStart(4, '0')}`,
        experience: `${Math.floor(Math.random() * 8) + 2} years`,
        currentCompany: 'Previous Company Inc.',
        currentPosition: 'Software Developer',
        skills: ['JavaScript', 'TypeScript', 'React', 'Node.js'],
        notes: 'Promising candidate with good technical skills',
        createdBy: admin.id,
      },
    });
    candidates.push(candidate);
  }

  console.log('Candidates created:', candidates.length);

  // Create Interviews
  const interviews = [];
  const interviewTypes = ['Technical', 'Behavioral', 'System Design', 'Cultural Fit'];
  const statuses = ['scheduled', 'completed', 'cancelled', 'in-progress'];

  for (let i = 0; i < 20; i++) {
    const candidate = candidates[i % candidates.length];
    const position = [seniorDevPosition, frontendDevPosition, backendDevPosition, productManagerPosition][i % 4];
    const round = Math.floor(i / 5) + 1;
    const interviewDate = new Date();
    interviewDate.setDate(interviewDate.getDate() + i);
    
    const startTime = new Date(interviewDate);
    startTime.setHours(10 + (i % 4), 0, 0);
    
    const endTime = new Date(startTime);
    endTime.setHours(startTime.getHours() + 1);

    const interview = await prisma.interview.create({
      data: {
        round,
        type: interviewTypes[i % interviewTypes.length],
        date: interviewDate.toISOString().split('T')[0],
        startTime,
        endTime,
        status: statuses[i % statuses.length],
        candidateId: candidate.id,
        positionId: position.id,
        createdBy: admin.id,
        interviewerIds: [interviewer1.id, interviewer2.id],
      },
    });
    interviews.push(interview);
  }

  console.log('Interviews created:', interviews.length);
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
