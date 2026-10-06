const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  subtaskId: { type: String, default: () => `sub_${Date.now()}_${Math.floor(Math.random()*1000)}` },
  title: { type: String, required: true, trim: true },
  assignedTo: { type: String, default: 'Unassigned', trim: true },
  assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['To Do', 'In Progress', 'Review', 'Completed'], default: 'To Do' },
  priority: { type: String, enum: ['Urgent', 'High', 'Medium', 'Low'], default: 'Medium' },
  startDate: { type: Date, default: null },
  dueDate: { type: Date, default: null },
  isCompleted: { type: Boolean, default: false },
  progress: { type: Number, min: 0, max: 100, default: 0 },
});

const taskDependencySchema = new mongoose.Schema({
  taskId: { type: String, required: true },
  taskTitle: { type: String, default: '' },
  type: {
    type: String,
    enum: ['Finish-to-Start', 'Start-to-Start', 'Finish-to-Finish', 'Start-to-Finish', 'FS', 'SS', 'FF', 'SF'],
    default: 'Finish-to-Start',
  },
});

const projectTaskSchema = new mongoose.Schema({
  taskId: { type: String, default: () => `TSK-${Math.floor(100 + Math.random() * 900)}` },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  phaseId: { type: String, default: '' },
  phaseName: { type: String, default: '' },
  milestoneId: { type: String, default: '' },
  milestoneTitle: { type: String, default: '' },
  taskList: { type: String, default: 'General Deliverables' },
  assignedTo: { type: String, default: 'Unassigned', trim: true },
  assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  priority: { type: String, enum: ['Urgent', 'High', 'Medium', 'Low'], default: 'Medium' },
  status: { type: String, enum: ['To Do', 'In Progress', 'Review', 'Completed'], default: 'To Do' },
  startDate: { type: Date, default: Date.now },
  dueDate: { type: Date, default: null },
  estimatedHours: { type: Number, default: 0 },
  actualHours: { type: Number, default: 0 },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  tags: { type: [String], default: [] },
  dependencies: [taskDependencySchema],
  recurrence: {
    frequency: { type: String, enum: ['None', 'Daily', 'Weekly', 'Monthly'], default: 'None' },
    interval: { type: Number, default: 1 },
    until: { type: Date, default: null },
  },
  subtasks: [subtaskSchema],
  comments: [
    {
      commentId: { type: String, default: () => `cmt_${Date.now()}` },
      text: { type: String, required: true },
      authorName: { type: String, default: 'System' },
      authorRole: { type: String, default: 'User' },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  attachments: [
    {
      name: { type: String, required: true },
      url: { type: String, required: true },
      type: { type: String, default: 'application/octet-stream' },
      size: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: String, default: '' },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const milestoneSchema = new mongoose.Schema({
  milestoneId: { type: String, default: () => `MS-${Math.floor(10 + Math.random() * 90)}` },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: { type: String, default: '', trim: true },
  phaseId: { type: String, default: '' },
  phaseName: { type: String, default: '' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ownerName: { type: String, default: 'Unassigned', trim: true },
  startDate: { type: Date, default: null },
  dueDate: {
    type: Date,
    default: null,
  },
  isCompleted: {
    type: Boolean,
    default: false,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['Upcoming', 'In Progress', 'Completed', 'Delayed', 'On Hold'],
    default: 'Upcoming',
  },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  weight: {
    type: Number,
    default: 1, // weight in progress calculation
  },
  approvalStatus: {
    type: String,
    enum: ['None', 'Pending Approval', 'Approved', 'Rejected'],
    default: 'None',
  },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  comments: [
    {
      commentId: { type: String, default: () => `cmt_${Date.now()}` },
      text: { type: String, required: true },
      authorName: { type: String, default: 'System' },
      authorRole: { type: String, default: 'User' },
      createdAt: { type: Date, default: Date.now },
    },
  ],
});

const phaseSchema = new mongoose.Schema({
  phaseId: { type: String, default: () => `PH-${Math.floor(10 + Math.random() * 90)}` },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  order: { type: Number, default: 1 },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['Upcoming', 'In Progress', 'Completed', 'On Hold'], default: 'Upcoming' },
  progress: { type: Number, min: 0, max: 100, default: 0 },
});

const issueSchema = new mongoose.Schema({
  issueId: { type: String, default: () => `ISS-${Math.floor(100 + Math.random() * 900)}` },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  phaseId: { type: String, default: '' },
  phaseName: { type: String, default: '' },
  milestoneId: { type: String, default: '' },
  taskId: { type: String, default: '' },
  reportedBy: { type: String, default: 'System', trim: true },
  reportedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTo: { type: String, default: 'Unassigned', trim: true },
  assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  priority: { type: String, enum: ['Urgent', 'High', 'Medium', 'Low'], default: 'Medium' },
  severity: { type: String, enum: ['Critical', 'Major', 'Moderate', 'Minor'], default: 'Moderate' },
  status: {
    type: String,
    enum: ['Open', 'Assigned', 'In Progress', 'Resolved', 'Closed'],
    default: 'Open',
  },
  createdAt: { type: Date, default: Date.now },
  dueDate: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  resolution: { type: String, default: '', trim: true },
});

const riskSchema = new mongoose.Schema({
  riskId: { type: String, default: () => `RSK-${Math.floor(100 + Math.random() * 900)}` },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  probability: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
  impact: { type: String, enum: ['Critical', 'High', 'Medium', 'Low'], default: 'Medium' },
  riskLevel: { type: String, enum: ['Critical', 'High', 'Medium', 'Low'], default: 'Medium' },
  owner: { type: String, default: 'Unassigned', trim: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  mitigationPlan: { type: String, default: '', trim: true },
  dueDate: { type: Date, default: null },
  status: { type: String, enum: ['Identified', 'Mitigating', 'Resolved', 'Closed'], default: 'Identified' },
  createdAt: { type: Date, default: Date.now },
});

const timesheetSchema = new mongoose.Schema({
  timesheetId: { type: String, default: () => `TS-${Date.now()}` },
  date: { type: Date, default: Date.now },
  phaseId: { type: String, default: '' },
  phaseName: { type: String, default: '' },
  milestoneId: { type: String, default: '' },
  milestoneTitle: { type: String, default: '' },
  taskId: { type: String, default: '' },
  taskTitle: { type: String, default: 'General Project Work' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  userName: { type: String, default: 'Team Member', trim: true },
  startTime: { type: String, default: '09:00' },
  endTime: { type: String, default: '17:00' },
  totalHours: { type: Number, required: true, default: 0 },
  isBillable: { type: Boolean, default: true },
  notes: { type: String, default: '', trim: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const documentSchema = new mongoose.Schema({
  docId: { type: String, default: () => `doc_${Date.now()}_${Math.floor(Math.random()*1000)}` },
  name: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, default: 'application/octet-stream' },
  size: { type: Number, default: 0 },
  category: { type: String, default: 'Specification' },
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: String, default: '' },
  uploadedByName: { type: String, default: '' },
  version: { type: String, default: 'v1.0' },
});

const projectCommentSchema = new mongoose.Schema({
  commentId: { type: String, default: () => `cmt_${Date.now()}_${Math.floor(Math.random()*1000)}` },
  text: { type: String, required: true, trim: true },
  isInternal: { type: Boolean, default: false },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  authorName: { type: String, default: 'User', trim: true },
  authorRole: { type: String, default: 'Team Member', trim: true },
  createdAt: { type: Date, default: Date.now },
  attachments: [
    {
      name: { type: String },
      url: { type: String },
    },
  ],
});

const activityHistorySchema = new mongoose.Schema({
  eventId: { type: String, default: () => `evt_${Date.now()}` },
  action: { type: String, required: true },
  description: { type: String, default: '' },
  performedBy: { type: String, default: 'System' },
  performedByName: { type: String, default: 'System Daemon' },
  performedRole: { type: String, default: 'System' },
  timestamp: { type: Date, default: Date.now },
  delta: { type: String, default: '' },
});

const projectApprovalSchema = new mongoose.Schema({
  approvalId: { type: String, default: () => `app_${Date.now()}` },
  type: {
    type: String,
    enum: ['Project Approval', 'Milestone Approval', 'Timesheet Approval', 'Completion Approval', 'Budget Change'],
    default: 'Project Approval',
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  targetEntityId: { type: String, default: '' },
  targetEntityName: { type: String, default: '' },
  requestedBy: { type: String, default: 'System' },
  requestedAt: { type: Date, default: Date.now },
  approvedBy: { type: String, default: '' },
  approvedByName: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  remarks: { type: String, default: '' },
});

const projectSchema = new mongoose.Schema({
  projectCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: [true, 'Please provide the project name'],
    trim: true,
  },
  clientName: {
    type: String,
    required: [true, 'Please provide the client name'],
    trim: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  leadId: {
    type: String,
    default: '',
    trim: true,
  },
  opportunityId: {
    type: String,
    default: '',
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  category: {
    type: String,
    enum: [
      'Enterprise Software',
      'Cloud Migration',
      'Web Application',
      'Mobile Development',
      'System Integration',
      'Infrastructure & DevOps',
      'Consulting & Audit',
      'Custom Delivery',
    ],
    default: 'Web Application',
  },
  projectType: {
    type: String,
    enum: ['Client Deliverable', 'Internal Project', 'Retainer Service', 'Fixed Price Contract', 'Time & Material (T&M)'],
    default: 'Client Deliverable',
  },
  department: {
    type: String,
    default: 'Engineering & Operations',
    trim: true,
  },
  status: {
    type: String,
    enum: ['Draft', 'Planning', 'Approved', 'In Progress', 'Under Review', 'On Hold', 'Completed', 'Closed', 'Cancelled'],
    default: 'Planning',
  },
  priority: {
    type: String,
    enum: ['Urgent', 'High', 'Medium', 'Low'],
    default: 'Medium',
  },
  budget: {
    type: Number,
    default: 0,
  },
  plannedCost: {
    type: Number,
    default: 0,
  },
  actualCost: {
    type: Number,
    default: 0,
  },
  budgetedHours: {
    type: Number,
    default: 0,
  },
  actualHours: {
    type: Number,
    default: 0,
  },
  currency: {
    type: String,
    enum: ['USD', 'INR'],
    default: 'USD',
  },
  billingType: {
    type: String,
    enum: ['Fixed Cost', 'Time & Material', 'Non-Billable'],
    default: 'Fixed Cost',
  },
  billingMethod: {
    type: String,
    enum: ['Milestone Based', 'Hourly Rate', 'Fixed Monthly', 'Deliverable Sign-Off'],
    default: 'Milestone Based',
  },
  estimatedCost: {
    type: Number,
    default: 0,
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  targetDate: {
    type: Date,
    required: [true, 'Please provide target completion date'],
  },
  actualStartDate: {
    type: Date,
    default: null,
  },
  actualEndDate: {
    type: Date,
    default: null,
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  ownerName: {
    type: String,
    default: 'Unassigned',
    trim: true,
  },
  projectOwner: {
    type: String,
    default: 'Unassigned',
    trim: true,
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  managerName: {
    type: String,
    default: 'Unassigned',
    trim: true,
  },
  projectManager: {
    type: String,
    default: 'Unassigned',
    trim: true,
  },
  teamMembers: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      name: String,
      role: String,
      email: String,
      hourlyRate: { type: Number, default: 0 },
      responsibilities: { type: String, default: '' },
    },
  ],
  phases: [phaseSchema],
  milestones: [milestoneSchema],
  tasks: [projectTaskSchema],
  issues: [issueSchema],
  risks: [riskSchema],
  timesheets: [timesheetSchema],
  attachments: [documentSchema],
  documents: [documentSchema],
  comments: [projectCommentSchema],
  activityHistory: [activityHistorySchema],
  approvals: [projectApprovalSchema],
  deliverableTasks: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
    },
  ],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-calculate progress and stats
projectSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // Synchronize Manager and Owner aliases
  const finalMgr = this.managerName && this.managerName !== 'Unassigned'
    ? this.managerName
    : this.projectManager || 'Unassigned';
  this.managerName = finalMgr;
  this.projectManager = finalMgr;

  const finalOwn = this.ownerName && this.ownerName !== 'Unassigned'
    ? this.ownerName
    : this.projectOwner || 'Unassigned';
  this.ownerName = finalOwn;
  this.projectOwner = finalOwn;

  // Progress computation: Weighted milestones or tasks
  if (this.milestones && this.milestones.length > 0) {
    const totalMilestones = this.milestones.length;
    const completedCount = this.milestones.filter((m) => m.isCompleted || m.status === 'Completed').length;
    this.progress = Math.round((completedCount / totalMilestones) * 100);
    if (this.progress === 100 && this.status !== 'Completed' && this.status !== 'Closed') {
      this.status = 'Completed';
      this.actualEndDate = this.actualEndDate || new Date();
    }
  } else if (this.tasks && this.tasks.length > 0) {
    const totalTasks = this.tasks.length;
    const completedTasks = this.tasks.filter((t) => t.status === 'Completed').length;
    this.progress = Math.round((completedTasks / totalTasks) * 100);
  }

  // Sum actual hours from timesheets
  if (this.timesheets && this.timesheets.length > 0) {
    this.actualHours = this.timesheets
      .filter((ts) => ts.status !== 'Rejected')
      .reduce((acc, ts) => acc + (Number(ts.totalHours) || 0), 0);
  }

  next();
});

projectSchema.index({ status: 1 });
projectSchema.index({ priority: 1 });
projectSchema.index({ manager: 1 });
projectSchema.index({ managerName: 1 });
projectSchema.index({ createdBy: 1 });
projectSchema.index({ targetEndDate: 1 });
projectSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Project', projectSchema);
