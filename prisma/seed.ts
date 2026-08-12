import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  await prisma.interviewFeedback.deleteMany();
  await prisma.interviewRound.deleteMany();
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

  const namedInterviewers = [
    { firstname: 'Sarah', lastname: 'Malik', email: 'sarah.malik@company.com', password: 'sarah123', designation: 'Senior Interviewer' },
    { firstname: 'Daniel', lastname: 'Shah', email: 'daniel.shah@company.com', password: 'daniel123', designation: 'Interviewer' },
    { firstname: 'Ali', lastname: 'Hassan', email: 'ali.hassan@company.com', password: 'ali123', designation: 'Senior Interviewer' },
    { firstname: 'Ahmed', lastname: 'Khan', email: 'ahmed.khan@company.com', password: 'ahmed123', designation: 'Interviewer' },
    { firstname: 'Aisha', lastname: 'Noor', email: 'aisha.noor@company.com', password: 'aisha123', designation: 'Interviewer' },
    { firstname: 'Michael', lastname: 'Reed', email: 'michael.reed@company.com', password: 'michael123', designation: 'Senior Interviewer' },
  ];

  const createdInterviewers = [];
  for (let i = 0; i < namedInterviewers.length; i++) {
    const ni = namedInterviewers[i];
    const interviewer = await prisma.user.create({
      data: {
        employeeId: `EMP00${4 + i}`,
        firstname: ni.firstname,
        lastname: ni.lastname,
        email: ni.email,
        password: await bcrypt.hash(ni.password, 10),
        roleId: interviewerRole.id,
        designation: ni.designation,
        phone: `+123456789${4 + i}`,
      },
    });
    createdInterviewers.push(interviewer);
  }

  console.log('Users created:', { admin, interviewer1, interviewer2, namedInterviewers: createdInterviewers.map((u) => u.email) });

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

  const interviewTypes = ['Technical', 'Behavioral', 'System Design', 'Cultural Fit'];

  // Create interviews WITHOUT rounds (backward compatible)
  const directInterviews = [];
  for (let i = 0; i < 10; i++) {
    const candidate = candidates[i % candidates.length];
    const position = [seniorDevPosition, frontendDevPosition, backendDevPosition, productManagerPosition][i % 4];
    const interviewDate = new Date();
    interviewDate.setDate(interviewDate.getDate() + i);
    
    const startTime = new Date(interviewDate);
    startTime.setHours(10 + (i % 4), 0, 0);
    
    const endTime = new Date(startTime);
    endTime.setHours(startTime.getHours() + 1);

    const interview = await prisma.interview.create({
      data: {
        round: i + 1,
        type: interviewTypes[i % interviewTypes.length],
        date: interviewDate.toISOString().split('T')[0],
        startTime,
        endTime,
        status: i < 5 ? 'completed' : 'scheduled',
        candidateId: candidate.id,
        positionId: position.id,
        createdBy: admin.id,
        interviewerIds: [interviewer1.id, interviewer2.id],
      },
    });
    directInterviews.push(interview);
  }

  console.log('Direct interviews created:', directInterviews.length);

  // Create interviews WITH rounds (multi-round interviews)
  const multiRoundInterviews = [];
  for (let i = 0; i < 5; i++) {
    const candidate = candidates[5 + i];
    const position = [seniorDevPosition, frontendDevPosition, backendDevPosition, productManagerPosition][i % 4];
    const interviewDate = new Date();
    interviewDate.setDate(interviewDate.getDate() + 10 + i);
    
    const startTime = new Date(interviewDate);
    startTime.setHours(10 + (i % 4), 0, 0);
    
    const endTime = new Date(startTime);
    endTime.setHours(startTime.getHours() + 1);

    const interview = await prisma.interview.create({
      data: {
        round: 1,
        type: interviewTypes[0],
        date: interviewDate.toISOString().split('T')[0],
        startTime,
        endTime,
        status: 'scheduled',
        candidateId: candidate.id,
        positionId: position.id,
        createdBy: admin.id,
        interviewerIds: [interviewer1.id, interviewer2.id],
      },
    });

    // Create rounds for this interview
    const round1Status = i < 3 ? 'completed' : 'scheduled';
    const round1Decision = i === 0 || i === 1 ? 'next_round' : i === 2 ? 'pending' : 'pending';

    const round1 = await prisma.interviewRound.create({
      data: {
        interviewId: interview.id,
        roundNumber: 1,
        type: 'Technical',
        duration: 60,
        date: interviewDate.toISOString().split('T')[0],
        startTime,
        endTime,
        status: round1Status,
        decision: round1Decision,
        decisionUpdatedAt: round1Decision === 'next_round' ? new Date() : null,
        decisionUpdatedBy: round1Decision === 'next_round' ? admin.id : null,
        interviewerIds: [interviewer1.id, createdInterviewers[0].id],
      },
    });

    const round2Date = new Date(interviewDate);
    round2Date.setDate(round2Date.getDate() + 3);
    const round2Start = new Date(round2Date);
    round2Start.setHours(14, 0, 0);
    const round2End = new Date(round2Start);
    round2End.setHours(15, 0, 0);

    const round2Status = i === 0 ? 'completed' : i === 1 ? 'scheduled' : 'pending';
    const round2Decision = i === 0 ? 'pending' : 'pending';

    const round2 = await prisma.interviewRound.create({
      data: {
        interviewId: interview.id,
        roundNumber: 2,
        type: 'Behavioral',
        duration: 45,
        date: i < 2 ? round2Date.toISOString().split('T')[0] : null,
        startTime: i < 2 ? round2Start : null,
        endTime: i < 2 ? round2End : null,
        status: round2Status,
        decision: round2Decision,
        interviewerIds: [interviewer2.id, createdInterviewers[1].id],
      },
    });

    const round3 = await prisma.interviewRound.create({
      data: {
        interviewId: interview.id,
        roundNumber: 3,
        type: 'System Design',
        duration: 90,
        date: null,
        startTime: null,
        endTime: null,
        status: 'pending',
        interviewerIds: [createdInterviewers[2].id, createdInterviewers[3].id],
      },
    });

    multiRoundInterviews.push({ interview, rounds: [round1, round2, round3] });
  }

  console.log('Multi-round interviews created:', multiRoundInterviews.length);

  // Create some feedback for completed interviews
  for (const interview of directInterviews.slice(0, 3)) {
    await prisma.interviewFeedback.create({
      data: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        interviewerId: interviewer1.id,
        rating: 4,
        recommendation: 'Strong Hire',
        positiveComments: 'Excellent technical skills and problem-solving ability',
        negativeComments: 'Could improve on communication',
        additionalComments: 'Would recommend for senior role',
      },
    });

    await prisma.interviewFeedback.create({
      data: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        interviewerId: interviewer2.id,
        rating: 3,
        recommendation: 'Hire',
        positiveComments: 'Good cultural fit and team player',
        negativeComments: 'Needs more experience with distributed systems',
        additionalComments: '',
      },
    });
  }

  // Create feedback for multi-round interviews (round-level feedback)
  for (const { interview, rounds } of multiRoundInterviews.slice(0, 2)) {
    if (rounds[0].status === 'completed') {
      await prisma.interviewFeedback.create({
        data: {
          interviewId: interview.id,
          roundId: rounds[0].id,
          candidateId: interview.candidateId,
          interviewerId: interviewer1.id,
          rating: 5,
          recommendation: 'Strong Hire',
          positiveComments: 'Outstanding coding skills and system design knowledge',
          negativeComments: '',
          additionalComments: 'Top candidate for the role',
        },
      });

      await prisma.interviewFeedback.create({
        data: {
          interviewId: interview.id,
          roundId: rounds[0].id,
          candidateId: interview.candidateId,
          interviewerId: createdInterviewers[0].id,
          rating: 4,
          recommendation: 'Hire',
          positiveComments: 'Strong problem-solving abilities',
          negativeComments: 'Minor time management issues',
          additionalComments: '',
        },
      });
    }
  }

  console.log('Feedback created');
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
