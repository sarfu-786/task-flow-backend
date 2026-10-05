const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const Project = require('../models/Project');
const User = require('../models/User');
const Task = require('../models/Task');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');
const { logAuditAction } = require('../services/auditService');
const {
  getAllUsers,
  getUserScopeContext,
  isProjectAccessible,
  getSubordinateUserIds,
} = require('../services/hierarchyService');

// Helper to check if Project Management module is active
const isProjectModuleActive = () => {
  const activeMods = fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects', 'tasks'];
  return activeMods.includes('projects');
};

// Middleware to enforce module enablement
const requireProjectModule = (req, res, next) => {
  if (!isProjectModuleActive()) {
    return res.status(403).json({
      success: false,
      moduleDisabled: true,
      message: 'Project Management module is not activated for your organization.',
    });
  }
  next();
};

router.use(protect, requireProjectModule);

// Helper to generate project code
const generateProjectCode = (existingProjects = []) => {
  const count = existingProjects.length + 1;
  const rand = Math.floor(100 + Math.random() * 900);
  return `PRJ-${count < 10 ? '0' + count : count}-${rand}`;
};

/**
 * Check if a user can access a project based on strict organizational hierarchy
 */
const canUserAccessProject = (currentUser, project, allUsers = []) => {
  if (!currentUser || !project) return false;
  const scope = getUserScopeContext(currentUser, allUsers);
  return isProjectAccessible(scope, project);
};

/**
 * Check if user can modify/manage a project (Super Admin, Manager in chain, or Project Owner/Manager)
 */
const canUserModifyProject = (currentUser, project, allUsers = []) => {
  if (!currentUser || !project) return false;
  const scope = getUserScopeContext(currentUser, allUsers);
  if (scope.isSuperAdmin) return true;

  const currentUserId = (currentUser._id || currentUser.id || '').toString().trim();
  const currentUserName = (currentUser.name || '').toLowerCase().trim();

  const pManagerId = project.manager ? (project.manager._id ? project.manager._id.toString() : project.manager.toString()).trim() : '';
  const pManagerName = (project.managerName || '').toLowerCase().trim();
  const pOwnerId = project.owner ? (project.owner._id ? project.owner._id.toString() : project.owner.toString()).trim() : '';
  const pOwnerName = (project.ownerName || '').toLowerCase().trim();
  const pCreatedById = project.createdBy ? (project.createdBy._id ? project.createdBy._id.toString() : project.createdBy.toString()).trim() : '';

  if (pManagerId && scope.allowedUserIds.has(pManagerId)) return true;
  if (pOwnerId && scope.allowedUserIds.has(pOwnerId)) return true;
  if (pCreatedById && scope.allowedUserIds.has(pCreatedById)) return true;
  if (pManagerName && scope.allowedNames.has(pManagerName)) return true;
  if (pOwnerName && scope.allowedNames.has(pOwnerName)) return true;

  return false;
};

/**
 * Fetch scoped projects and users
 */
const getScopedProjectsAndUsers = async (user) => {
  let projectsList = [];
  let allUsers = [];

  if (fallbackStore.isFallback) {
    projectsList = [...(fallbackStore.projects || [])];
    allUsers = fallbackStore.users || [];
  } else {
    const dbProjects = await Project.find({}).sort({ createdAt: -1 });
    projectsList = dbProjects.map((p) => (typeof p.toObject === 'function' ? p.toObject() : p));
    allUsers = await User.find({}).select('_id name username email role roles department reportsTo reportsToName createdBy').lean();
  }

  const scope = getUserScopeContext(user, allUsers);
  if (!scope.isSuperAdmin) {
    projectsList = projectsList.filter((p) => isProjectAccessible(scope, p));
  }

  return { projectsList, allUsers, scope };
};

// ==========================================
// 1. Predefined Project Templates Catalog
// ==========================================
const PROJECT_TEMPLATES = [
  {
    templateId: 'tpl_agile_software',
    name: 'Agile Software Product Delivery',
    category: 'Enterprise Software',
    description: 'End-to-end agile sprint delivery framework with discovery, sprint cycles, QA, and release management.',
    defaultBudget: 45000,
    currency: 'USD',
    billingType: 'Fixed Cost',
    phases: [
      { phaseId: 'PH-01', name: 'Discovery & Architecture', description: 'Requirements alignment and technical architecture design.', order: 1, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-02', name: 'Sprint Execution (Core)', description: 'Sprint development of core APIs and microservices.', order: 2, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-03', name: 'Frontend & UI Integration', description: 'Responsive dashboard and end-user interface building.', order: 3, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-04', name: 'QA Testing & UAT Sign-off', description: 'Automated regression, load testing, and client sign-off.', order: 4, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-05', name: 'Production Deployment', description: 'CI/CD pipeline rollout and monitoring setup.', order: 5, status: 'Upcoming', progress: 0 },
    ],
    milestones: [
      { milestoneId: 'MS-01', title: 'Scope Definition & Architecture Sign-off', phaseName: 'Discovery & Architecture', weight: 1, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-02', title: 'Alpha Release: Core API & Database', phaseName: 'Sprint Execution (Core)', weight: 2, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-03', title: 'Beta Release: Integrated UI Workflows', phaseName: 'Frontend & UI Integration', weight: 2, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-04', title: 'Client Acceptance & Final Handover', phaseName: 'QA Testing & UAT Sign-off', weight: 1, isCompleted: false, status: 'Upcoming' },
    ],
    tasks: [
      { taskId: 'TSK-101', title: 'Draft Technical Architecture Document', phaseName: 'Discovery & Architecture', milestoneTitle: 'Scope Definition & Architecture Sign-off', priority: 'High', status: 'To Do', estimatedHours: 24, progress: 0 },
      { taskId: 'TSK-102', title: 'Design RESTful Schema & Data Models', phaseName: 'Sprint Execution (Core)', milestoneTitle: 'Alpha Release: Core API & Database', priority: 'High', status: 'To Do', estimatedHours: 32, progress: 0 },
      { taskId: 'TSK-103', title: 'Implement Auth, RBAC & Hierarchy Enforcement', phaseName: 'Sprint Execution (Core)', milestoneTitle: 'Alpha Release: Core API & Database', priority: 'Urgent', status: 'To Do', estimatedHours: 28, progress: 0 },
      { taskId: 'TSK-104', title: 'Build Responsive Workspace UI Components', phaseName: 'Frontend & UI Integration', milestoneTitle: 'Beta Release: Integrated UI Workflows', priority: 'Medium', status: 'To Do', estimatedHours: 40, progress: 0 },
      { taskId: 'TSK-105', title: 'Conduct End-to-End Regression & Load Tests', phaseName: 'QA Testing & UAT Sign-off', milestoneTitle: 'Client Acceptance & Final Handover', priority: 'High', status: 'To Do', estimatedHours: 20, progress: 0 },
    ],
  },
  {
    templateId: 'tpl_cloud_migration',
    name: 'Cloud Infrastructure & DevOps Migration',
    category: 'Cloud Migration',
    description: 'Structured cloud replatforming, VPC networking, container orchestration, and zero-downtime cutover.',
    defaultBudget: 35000,
    currency: 'USD',
    billingType: 'Time & Material',
    phases: [
      { phaseId: 'PH-01', name: 'Infrastructure Audit & Assessment', description: 'Inventory of current servers, dependencies, and sizing.', order: 1, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-02', name: 'Target Cloud Architecture & IaC', description: 'Terraform/CloudFormation VPC and cluster provisioning.', order: 2, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-03', name: 'Database & Storage Migration', description: 'Live database replication and asset sync.', order: 3, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-04', name: 'Cutover, Validation & Monitoring', description: 'DNS cutover, SSL provisioning, and Datadog setup.', order: 4, status: 'Upcoming', progress: 0 },
    ],
    milestones: [
      { milestoneId: 'MS-01', title: 'Cloud Readiness Assessment Complete', phaseName: 'Infrastructure Audit & Assessment', weight: 1, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-02', title: 'IaC Infrastructure Staging Environment Ready', phaseName: 'Target Cloud Architecture & IaC', weight: 2, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-03', title: 'Production Cutover & Sign-Off', phaseName: 'Cutover, Validation & Monitoring', weight: 2, isCompleted: false, status: 'Upcoming' },
    ],
    tasks: [
      { taskId: 'TSK-201', title: 'Map existing network topologies & IAM policies', phaseName: 'Infrastructure Audit & Assessment', priority: 'High', status: 'To Do', estimatedHours: 16, progress: 0 },
      { taskId: 'TSK-202', title: 'Provision Terraform VPC, subnets, and NAT gateways', phaseName: 'Target Cloud Architecture & IaC', priority: 'Urgent', status: 'To Do', estimatedHours: 28, progress: 0 },
      { taskId: 'TSK-203', title: 'Set up Kubernetes cluster and Helm chart deployments', phaseName: 'Target Cloud Architecture & IaC', priority: 'High', status: 'To Do', estimatedHours: 36, progress: 0 },
      { taskId: 'TSK-204', title: 'Execute low-downtime database replication sync', phaseName: 'Database & Storage Migration', priority: 'Urgent', status: 'To Do', estimatedHours: 24, progress: 0 },
    ],
  },
  {
    templateId: 'tpl_web_redesign',
    name: 'Modern Web & Mobile Portal Redesign',
    category: 'Web Application',
    description: 'High-impact UI/UX overhaul with responsive design systems, accessibility, and speed optimizations.',
    defaultBudget: 22000,
    currency: 'USD',
    billingType: 'Fixed Cost',
    phases: [
      { phaseId: 'PH-01', name: 'UX Research & Wireframing', description: 'User persona mapping, Figma design tokens, and prototypes.', order: 1, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-02', name: 'Frontend Component Development', description: 'Pixel-perfect component library and responsive pages.', order: 2, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-03', name: 'API Integration & Optimization', description: 'State management, caching, and Lighthouse speed tuning.', order: 3, status: 'Upcoming', progress: 0 },
      { phaseId: 'PH-04', name: 'Launch & Analytics Setup', description: 'SEO optimization, event tracking, and go-live.', order: 4, status: 'Upcoming', progress: 0 },
    ],
    milestones: [
      { milestoneId: 'MS-01', title: 'Figma UI/UX Prototypes Approved', phaseName: 'UX Research & Wireframing', weight: 1, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-02', title: 'Frontend Component Library Built', phaseName: 'Frontend Component Development', weight: 2, isCompleted: false, status: 'Upcoming' },
      { milestoneId: 'MS-03', title: 'Production Go-Live & SEO Verification', phaseName: 'Launch & Analytics Setup', weight: 1, isCompleted: false, status: 'Upcoming' },
    ],
    tasks: [
      { taskId: 'TSK-301', title: 'Create interactive Figma design tokens and component specs', phaseName: 'UX Research & Wireframing', priority: 'High', status: 'To Do', estimatedHours: 30, progress: 0 },
      { taskId: 'TSK-302', title: 'Develop responsive navigation, hero sections, and tables', phaseName: 'Frontend Component Development', priority: 'Medium', status: 'To Do', estimatedHours: 40, progress: 0 },
      { taskId: 'TSK-303', title: 'Implement dark/light mode and mobile hamburger sheet', phaseName: 'Frontend Component Development', priority: 'Medium', status: 'To Do', estimatedHours: 18, progress: 0 },
      { taskId: 'TSK-304', title: 'Perform Cross-browser and WCAG 2.1 AA accessibility audit', phaseName: 'API Integration & Optimization', priority: 'High', status: 'To Do', estimatedHours: 16, progress: 0 },
    ],
  },
];

// @route   GET /api/projects/templates
// @desc    Get all available project templates
// @access  Private
router.get('/templates', async (req, res) => {
  return res.json({
    success: true,
    templates: PROJECT_TEMPLATES,
  });
});

// ==========================================
// 2. Project MIS & Analytics Dashboard
// ==========================================
// @route   GET /api/projects/stats/mis
// @desc    Get complete hierarchy-aware Project MIS metrics
// @access  Private
router.get('/stats/mis', async (req, res) => {
  try {
    const { projectsList, allUsers } = await getScopedProjectsAndUsers(req.user);

    const totalProjects = projectsList.length;
    const now = new Date();

    const byStatus = {
      Draft: 0,
      Planning: 0,
      Approved: 0,
      'In Progress': 0,
      'Under Review': 0,
      'On Hold': 0,
      Completed: 0,
      Closed: 0,
      Cancelled: 0,
    };

    const byPriority = {
      Urgent: 0,
      High: 0,
      Medium: 0,
      Low: 0,
    };

    let totalBudget = 0;
    let totalPlannedCost = 0;
    let totalActualCost = 0;
    let totalBudgetedHours = 0;
    let totalActualHours = 0;
    let totalProgressSum = 0;
    let overdueCount = 0;
    let upcomingDeadlinesCount = 0;

    let allTasks = [];
    let allMilestones = [];
    let allIssues = [];
    let allTimesheets = [];

    const managerBreakdown = {};
    const clientBreakdown = {};

    projectsList.forEach((p) => {
      // Status
      const st = p.status || 'Planning';
      if (byStatus[st] !== undefined) byStatus[st]++;
      else byStatus['In Progress']++;

      // Priority
      const pr = p.priority || 'Medium';
      if (byPriority[pr] !== undefined) byPriority[pr]++;

      // Financials & Hours
      totalBudget += Number(p.budget) || 0;
      totalPlannedCost += Number(p.plannedCost || p.budget) || 0;
      totalActualCost += Number(p.actualCost) || 0;
      totalBudgetedHours += Number(p.budgetedHours) || 0;
      totalActualHours += Number(p.actualHours) || 0;
      totalProgressSum += Number(p.progress) || 0;

      // Deadlines
      if (p.targetDate) {
        const target = new Date(p.targetDate);
        if (!isNaN(target.getTime())) {
          if (target < now && p.status !== 'Completed' && p.status !== 'Closed') {
            overdueCount++;
          } else {
            const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays <= 14) {
              upcomingDeadlinesCount++;
            }
          }
        }
      }

      // Manager Breakdown
      const mgr = p.managerName || 'Unassigned';
      if (!managerBreakdown[mgr]) {
        managerBreakdown[mgr] = { managerName: mgr, total: 0, active: 0, completed: 0, totalBudget: 0 };
      }
      managerBreakdown[mgr].total++;
      if (['In Progress', 'Planning', 'Approved', 'Under Review'].includes(p.status)) managerBreakdown[mgr].active++;
      if (p.status === 'Completed' || p.status === 'Closed') managerBreakdown[mgr].completed++;
      managerBreakdown[mgr].totalBudget += Number(p.budget) || 0;

      // Client Breakdown
      const cl = p.clientName || 'General Client';
      if (!clientBreakdown[cl]) {
        clientBreakdown[cl] = { clientName: cl, total: 0, totalBudget: 0 };
      }
      clientBreakdown[cl].total++;
      clientBreakdown[cl].totalBudget += Number(p.budget) || 0;

      // Sub-entities
      if (Array.isArray(p.tasks)) allTasks.push(...p.tasks.map((t) => ({ ...t, projectCode: p.projectCode, projectName: p.name })));
      if (Array.isArray(p.milestones)) allMilestones.push(...p.milestones.map((m) => ({ ...m, projectCode: p.projectCode, projectName: p.name })));
      if (Array.isArray(p.issues)) allIssues.push(...p.issues.map((i) => ({ ...i, projectCode: p.projectCode, projectName: p.name })));
      if (Array.isArray(p.timesheets)) allTimesheets.push(...p.timesheets.map((ts) => ({ ...ts, projectCode: p.projectCode, projectName: p.name })));
    });

    const avgProgress = totalProjects > 0 ? Math.round(totalProgressSum / totalProjects) : 0;
    const completedMilestones = allMilestones.filter((m) => m.isCompleted || m.status === 'Completed').length;
    const milestoneProgress = allMilestones.length > 0 ? Math.round((completedMilestones / allMilestones.length) * 100) : 0;
    const completedTasksCount = allTasks.filter((t) => t.status === 'Completed').length;
    const taskProgress = allTasks.length > 0 ? Math.round((completedTasksCount / allTasks.length) * 100) : 0;

    // Resource / Workload Summary
    const resourceWorkload = {};
    allUsers.forEach((u) => {
      resourceWorkload[u.name] = {
        userName: u.name,
        role: u.role,
        department: u.department,
        projectsCount: 0,
        assignedTasks: 0,
        completedTasks: 0,
        overdueTasks: 0,
        estimatedHours: 0,
        loggedHours: 0,
      };
    });

    projectsList.forEach((p) => {
      const isTeamUser = (uName) => {
        if (p.managerName === uName) return true;
        return (p.teamMembers || []).some((tm) => tm.name === uName);
      };

      Object.keys(resourceWorkload).forEach((uName) => {
        if (isTeamUser(uName)) resourceWorkload[uName].projectsCount++;
      });
    });

    allTasks.forEach((t) => {
      const assigned = t.assignedTo || 'Unassigned';
      if (!resourceWorkload[assigned]) {
        resourceWorkload[assigned] = { userName: assigned, role: 'Team Member', department: 'General', projectsCount: 1, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, estimatedHours: 0, loggedHours: 0 };
      }
      resourceWorkload[assigned].assignedTasks++;
      if (t.status === 'Completed') resourceWorkload[assigned].completedTasks++;
      if (t.dueDate && new Date(t.dueDate) < now && t.status !== 'Completed') {
        resourceWorkload[assigned].overdueTasks++;
      }
      resourceWorkload[assigned].estimatedHours += Number(t.estimatedHours) || 0;
      resourceWorkload[assigned].loggedHours += Number(t.actualHours) || 0;
    });

    const activeResources = Object.values(resourceWorkload).filter((r) => r.projectsCount > 0 || r.assignedTasks > 0 || r.loggedHours > 0);

    // Timesheet billable vs non-billable summary
    const totalBillableHours = allTimesheets.filter((ts) => ts.isBillable && ts.status !== 'Rejected').reduce((acc, ts) => acc + (Number(ts.totalHours) || 0), 0);
    const totalNonBillableHours = allTimesheets.filter((ts) => !ts.isBillable && ts.status !== 'Rejected').reduce((acc, ts) => acc + (Number(ts.totalHours) || 0), 0);

    return res.json({
      success: true,
      summary: {
        totalProjects,
        activeProjects: byStatus['In Progress'] + byStatus['Planning'] + byStatus['Approved'] + byStatus['Under Review'],
        inProgressProjects: byStatus['In Progress'],
        planningProjects: byStatus['Planning'],
        approvedProjects: byStatus['Approved'],
        underReviewProjects: byStatus['Under Review'],
        completedProjects: byStatus['Completed'] + byStatus['Closed'],
        onHoldProjects: byStatus['On Hold'],
        cancelledProjects: byStatus['Cancelled'],
        overdueProjects: overdueCount,
        upcomingDeadlines: upcomingDeadlinesCount,
        avgProgress,
        totalBudget,
        totalPlannedCost,
        totalActualCost,
        costVariance: totalBudget - totalActualCost,
        budgetUtilization: totalBudget > 0 ? Math.round((totalActualCost / totalBudget) * 100) : 0,
        totalBudgetedHours,
        totalActualHours,
        totalBillableHours,
        totalNonBillableHours,
        milestonesTotal: allMilestones.length,
        milestonesCompleted: completedMilestones,
        milestoneProgress,
        tasksTotal: allTasks.length,
        tasksCompleted: completedTasksCount,
        taskProgress,
        openIssuesCount: allIssues.filter((i) => i.status !== 'Closed' && i.status !== 'Resolved').length,
        totalIssuesCount: allIssues.length,
      },
      charts: {
        byStatus,
        byPriority,
        managerBreakdown: Object.values(managerBreakdown),
        clientBreakdown: Object.values(clientBreakdown),
        resourceWorkload: activeResources,
      },
    });
  } catch (err) {
    console.error('[Project MIS Analytics Error]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch Project MIS analytics', error: err.message });
  }
});

// ==========================================
// 3. Project Reports API
// ==========================================
// @route   GET /api/projects/reports/:reportType
// @desc    Get detailed report dataset by type
// @access  Private
router.get('/reports/:reportType', async (req, res) => {
  try {
    const { reportType } = req.params;
    const { category = 'project', status = 'all' } = req.query;
    const { projectsList, allUsers } = await getScopedProjectsAndUsers(req.user);

    let filteredProjects = projectsList;
    if (status && status !== 'all') {
      filteredProjects = filteredProjects.filter((p) => p.status === status);
    }

    const now = new Date();
    let reportTitle = 'Project Report';
    let rows = [];

    switch (reportType) {
      // ----------------------------------------------------
      // Category 1: PROJECT REPORTS
      // ----------------------------------------------------
      case 'status':
      case 'status-progress':
        reportTitle = 'Project Status & Health Summary';
        rows = filteredProjects.map((p) => ({
          'Project Code': p.projectCode || 'PRJ-000',
          'Project Name': p.name || '',
          'Client': p.clientName || 'Internal',
          'Project Manager': p.managerName || 'Unassigned',
          'Status': p.status || 'Planning',
          'Priority': p.priority || 'Medium',
          'Progress': `${p.progress || 0}%`,
          'Start Date': p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : '—',
          'Target Date': p.targetDate ? new Date(p.targetDate).toISOString().slice(0, 10) : '—',
          'Budget': `${p.currency || 'USD'} ${Number(p.budget || 0).toLocaleString()}`,
        }));
        break;

      case 'progress':
        reportTitle = 'Project Delivery & Progress % Report';
        rows = filteredProjects.map((p) => {
          const tasks = p.tasks || [];
          const completedTasks = tasks.filter((t) => t.status === 'Completed').length;
          const milestones = p.milestones || [];
          const completedMilestones = milestones.filter((m) => m.isCompleted || m.status === 'Completed').length;
          return {
            'Project Code': p.projectCode || 'PRJ-000',
            'Project Name': p.name || '',
            'Manager': p.managerName || 'Unassigned',
            'Progress': `${p.progress || 0}%`,
            'Status': p.status || 'Planning',
            'Phases Count': (p.phases || []).length,
            'Milestones Completed': `${completedMilestones} / ${milestones.length}`,
            'Tasks Completed': `${completedTasks} / ${tasks.length}`,
            'Billing Type': p.billingType || 'Fixed Cost',
          };
        });
        break;

      case 'timeline':
      case 'timeline-delays':
        reportTitle = 'Timeline & Target Date Schedule';
        rows = filteredProjects.map((p) => {
          const target = p.targetDate ? new Date(p.targetDate) : null;
          let scheduleStatus = 'On Schedule';
          if (target) {
            const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
            if (p.status === 'Completed' || p.status === 'Closed') {
              scheduleStatus = 'Delivered';
            } else if (diffDays < 0) {
              scheduleStatus = `Overdue by ${Math.abs(diffDays)}d`;
            } else if (diffDays <= 7) {
              scheduleStatus = `Due in ${diffDays}d (Urgent)`;
            } else {
              scheduleStatus = `Due in ${diffDays}d`;
            }
          }
          return {
            'Project Code': p.projectCode || 'PRJ-000',
            'Project Name': p.name || '',
            'Client': p.clientName || 'Internal',
            'Start Date': p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : '—',
            'Target Date': target ? target.toISOString().slice(0, 10) : '—',
            'Schedule Status': scheduleStatus,
            'Progress': `${p.progress || 0}%`,
            'Project Manager': p.managerName || 'Unassigned',
          };
        });
        break;

      case 'delays':
        reportTitle = 'Delay & Overdue Projects Audit';
        rows = filteredProjects
          .filter((p) => {
            const isDone = ['Completed', 'Closed'].includes(p.status);
            return !isDone && p.targetDate && new Date(p.targetDate) < now;
          })
          .map((p) => {
            const target = new Date(p.targetDate);
            const delayDays = Math.ceil((now - target) / (1000 * 60 * 60 * 24));
            const openIssues = (p.issues || []).filter((i) => !['Closed', 'Resolved'].includes(i.status)).length;
            return {
              'Project Code': p.projectCode || 'PRJ-000',
              'Project Name': p.name || '',
              'Manager': p.managerName || 'Unassigned',
              'Target Date': target.toISOString().slice(0, 10),
              'Delay Duration': `${delayDays} days overdue`,
              'Current Status': p.status || 'Planning',
              'Priority': p.priority || 'High',
              'Progress': `${p.progress || 0}%`,
              'Open Defects': openIssues,
            };
          });
        break;

      case 'manager':
        reportTitle = 'Manager-wise Project Portfolio Report';
        const mgrMap = {};
        filteredProjects.forEach((p) => {
          const mgr = p.managerName || 'Unassigned';
          if (!mgrMap[mgr]) {
            mgrMap[mgr] = {
              'Project Manager': mgr,
              'Total Projects': 0,
              'In Execution': 0,
              'Delivered': 0,
              'Total Budget ($)': 0,
              'Total Progress': 0,
            };
          }
          mgrMap[mgr]['Total Projects'] += 1;
          if (['In Progress', 'Planning', 'Approved', 'Under Review'].includes(p.status)) {
            mgrMap[mgr]['In Execution'] += 1;
          }
          if (['Completed', 'Closed'].includes(p.status)) {
            mgrMap[mgr]['Delivered'] += 1;
          }
          mgrMap[mgr]['Total Budget ($)'] += Number(p.budget) || 0;
          mgrMap[mgr]['Total Progress'] += Number(p.progress) || 0;
        });
        rows = Object.values(mgrMap).map((m) => ({
          ...m,
          'Total Budget ($)': `$${m['Total Budget ($)'].toLocaleString()}`,
          'Avg Progress': `${m['Total Projects'] > 0 ? Math.round(m['Total Progress'] / m['Total Projects']) : 0}%`,
        }));
        break;

      case 'client':
        reportTitle = 'Client-wise Project Accounts Report';
        const clMap = {};
        filteredProjects.forEach((p) => {
          const cl = p.clientName || 'General Client';
          if (!clMap[cl]) {
            clMap[cl] = {
              'Client Account': cl,
              'Total Projects': 0,
              'Active Deliverables': 0,
              'Delivered': 0,
              'Portfolio Valuation': 0,
            };
          }
          clMap[cl]['Total Projects'] += 1;
          if (['In Progress', 'Planning', 'Approved'].includes(p.status)) clMap[cl]['Active Deliverables'] += 1;
          if (['Completed', 'Closed'].includes(p.status)) clMap[cl]['Delivered'] += 1;
          clMap[cl]['Portfolio Valuation'] += Number(p.budget) || 0;
        });
        rows = Object.values(clMap).map((c) => ({
          ...c,
          'Portfolio Valuation': `$${c['Portfolio Valuation'].toLocaleString()}`,
        }));
        break;

      // ----------------------------------------------------
      // Category 2: TASK REPORTS
      // ----------------------------------------------------
      case 'task_status':
        reportTitle = 'Task Status Breakdown Report';
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            rows.push({
              'Task Code': t.taskId || 'TSK-00',
              'Task Title': t.taskName || t.title,
              'Project': p.name,
              'Assignee': t.assignedTo || 'Unassigned',
              'Status': t.status || 'To Do',
              'Priority': t.priority || 'Medium',
              'Progress': `${t.progress || 0}%`,
              'Due Date': t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '—',
            });
          });
        });
        break;

      case 'task_priority':
        reportTitle = 'Task Priority Analysis Report';
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            rows.push({
              'Task Code': t.taskId || 'TSK-00',
              'Task Title': t.taskName || t.title,
              'Priority': t.priority || 'Medium',
              'Project': p.name,
              'Assignee': t.assignedTo || 'Unassigned',
              'Status': t.status || 'To Do',
              'Estimated Hours': `${t.estimatedHours || 0} hrs`,
              'Due Date': t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '—',
            });
          });
        });
        break;

      case 'task_owner':
        reportTitle = 'Task Owner & Assignment List';
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            rows.push({
              'Assignee': t.assignedTo || 'Unassigned',
              'Project Name': p.name,
              'Task Title': t.taskName || t.title,
              'Status': t.status || 'To Do',
              'Priority': t.priority || 'Medium',
              'Estimated Hours': `${t.estimatedHours || 0} hrs`,
              'Logged Hours': `${t.actualHours || 0} hrs`,
              'Due Date': t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '—',
            });
          });
        });
        break;

      case 'task_overdue':
        reportTitle = 'Overdue Project Tasks Audit';
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            const isDone = ['Done', 'Completed', 'Closed'].includes(t.status);
            if (!isDone && t.dueDate && new Date(t.dueDate) < now) {
              const overdueDays = Math.ceil((now - new Date(t.dueDate)) / (1000 * 60 * 60 * 24));
              rows.push({
                'Task Code': t.taskId || 'TSK-00',
                'Task Title': t.taskName || t.title,
                'Project': p.name,
                'Assignee': t.assignedTo || 'Unassigned',
                'Due Date': new Date(t.dueDate).toISOString().slice(0, 10),
                'Overdue Days': `${overdueDays} days`,
                'Priority': t.priority || 'High',
                'Status': t.status || 'In Progress',
              });
            }
          });
        });
        break;

      case 'milestone_tasks':
        reportTitle = 'Milestone-wise Deliverables Report';
        filteredProjects.forEach((p) => {
          (p.milestones || []).forEach((m) => {
            const milestoneTasks = (p.tasks || []).filter((t) => t.milestoneTitle === m.title || t.phaseName === m.phaseName);
            const doneCount = milestoneTasks.filter((t) => ['Done', 'Completed'].includes(t.status)).length;
            rows.push({
              'Milestone Title': m.title,
              'Phase Name': m.phaseName || 'General Phase',
              'Project Name': p.name,
              'Total Tasks': milestoneTasks.length,
              'Completed Tasks': doneCount,
              'Progress': `${milestoneTasks.length > 0 ? Math.round((doneCount / milestoneTasks.length) * 100) : m.isCompleted ? 100 : 0}%`,
              'Milestone Status': m.isCompleted || m.status === 'Completed' ? 'Completed' : 'In Progress',
            });
          });
        });
        break;

      // ----------------------------------------------------
      // Category 3: RESOURCE REPORTS
      // ----------------------------------------------------
      case 'workload':
      case 'resource-workload':
        reportTitle = 'Employee Workload & Capacity Report';
        const userTaskMap = {};
        allUsers.forEach((u) => {
          userTaskMap[u.name] = {
            'Employee Name': u.name,
            'Department': u.department || 'General',
            'Role': u.role || 'Team Member',
            'Assigned Tasks': 0,
            'Completed Tasks': 0,
            'Pending Tasks': 0,
            'Estimated Hours': 0,
            'Logged Hours': 0,
          };
        });
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            const assignee = t.assignedTo || 'Unassigned';
            if (!userTaskMap[assignee]) {
              userTaskMap[assignee] = {
                'Employee Name': assignee,
                'Department': 'General',
                'Role': 'Team Member',
                'Assigned Tasks': 0,
                'Completed Tasks': 0,
                'Pending Tasks': 0,
                'Estimated Hours': 0,
                'Logged Hours': 0,
              };
            }
            userTaskMap[assignee]['Assigned Tasks'] += 1;
            if (['Done', 'Completed'].includes(t.status)) userTaskMap[assignee]['Completed Tasks'] += 1;
            else userTaskMap[assignee]['Pending Tasks'] += 1;
            userTaskMap[assignee]['Estimated Hours'] += Number(t.estimatedHours) || 0;
            userTaskMap[assignee]['Logged Hours'] += Number(t.actualHours) || 0;
          });
        });
        rows = Object.values(userTaskMap)
          .filter((u) => u['Assigned Tasks'] > 0 || u['Logged Hours'] > 0)
          .map((u) => ({
            ...u,
            'Estimated Hours': `${u['Estimated Hours']} hrs`,
            'Logged Hours': `${u['Logged Hours']} hrs`,
            'Completion Rate': `${u['Assigned Tasks'] > 0 ? Math.round((u['Completed Tasks'] / u['Assigned Tasks']) * 100) : 0}%`,
          }));
        break;

      case 'assigned_vs_done':
        reportTitle = 'Assigned vs Completed Tasks Report';
        const doneMap = {};
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            const assignee = t.assignedTo || 'Unassigned';
            if (!doneMap[assignee]) {
              doneMap[assignee] = { 'Employee Name': assignee, 'Assigned Tasks': 0, 'Completed Tasks': 0, 'Pending Tasks': 0 };
            }
            doneMap[assignee]['Assigned Tasks'] += 1;
            if (['Done', 'Completed'].includes(t.status)) doneMap[assignee]['Completed Tasks'] += 1;
            else doneMap[assignee]['Pending Tasks'] += 1;
          });
        });
        rows = Object.values(doneMap).map((d) => ({
          ...d,
          'Completion Rate': `${d['Assigned Tasks'] > 0 ? Math.round((d['Completed Tasks'] / d['Assigned Tasks']) * 100) : 0}%`,
        }));
        break;

      case 'logged_hours':
        reportTitle = 'Logged vs Estimated Hours Report';
        const hoursMap = {};
        filteredProjects.forEach((p) => {
          (p.tasks || []).forEach((t) => {
            const assignee = t.assignedTo || 'Unassigned';
            if (!hoursMap[assignee]) {
              hoursMap[assignee] = { 'Employee Name': assignee, 'Estimated Hours': 0, 'Logged Hours': 0 };
            }
            hoursMap[assignee]['Estimated Hours'] += Number(t.estimatedHours) || 0;
            hoursMap[assignee]['Logged Hours'] += Number(t.actualHours) || 0;
          });
        });
        rows = Object.values(hoursMap).map((h) => ({
          'Employee Name': h['Employee Name'],
          'Estimated Hours': `${h['Estimated Hours']} hrs`,
          'Logged Hours': `${h['Logged Hours']} hrs`,
          'Variance': `${h['Estimated Hours'] - h['Logged Hours']} hrs`,
          'Utilization %': `${h['Estimated Hours'] > 0 ? Math.round((h['Logged Hours'] / h['Estimated Hours']) * 100) : 0}%`,
        }));
        break;

      case 'billable':
        reportTitle = 'Billable vs Non-Billable Hours Report';
        const billMap = {};
        filteredProjects.forEach((p) => {
          (p.timesheets || []).forEach((ts) => {
            const user = ts.userName || ts.user || 'Team Member';
            if (!billMap[user]) {
              billMap[user] = { 'Employee Name': user, 'Billable Hours': 0, 'Non-Billable Hours': 0, 'Total Hours': 0 };
            }
            const hrs = Number(ts.hours || ts.totalHours) || 0;
            billMap[user]['Total Hours'] += hrs;
            if (ts.isBillable) billMap[user]['Billable Hours'] += hrs;
            else billMap[user]['Non-Billable Hours'] += hrs;
          });
        });
        rows = Object.values(billMap).map((b) => ({
          'Employee Name': b['Employee Name'],
          'Billable Hours': `${b['Billable Hours']} hrs`,
          'Non-Billable Hours': `${b['Non-Billable Hours']} hrs`,
          'Total Hours': `${b['Total Hours']} hrs`,
          'Billable Ratio': `${b['Total Hours'] > 0 ? Math.round((b['Billable Hours'] / b['Total Hours']) * 100) : 0}%`,
        }));
        break;

      // ----------------------------------------------------
      // Category 4: FINANCIAL REPORTS
      // ----------------------------------------------------
      case 'budget_overview':
      case 'budget-variance':
        reportTitle = 'Project Budget & Cost Overview';
        rows = filteredProjects.map((p) => {
          const budget = Number(p.budget) || 0;
          const actual = Number(p.actualCost) || 0;
          const variance = budget - actual;
          const util = budget > 0 ? Math.round((actual / budget) * 100) : 0;
          return {
            'Project Code': p.projectCode || 'PRJ-000',
            'Project Name': p.name,
            'Client': p.clientName || 'Internal',
            'Billing Type': p.billingType || 'Fixed Cost',
            'Total Budget': `$${budget.toLocaleString()}`,
            'Actual Cost': `$${actual.toLocaleString()}`,
            'Remaining Margin': `$${variance.toLocaleString()}`,
            'Budget Utilization': `${util}%`,
            'Status': p.status,
          };
        });
        break;

      case 'cost_variance':
        reportTitle = 'Cost Variance & Margin Analysis';
        rows = filteredProjects.map((p) => {
          const budget = Number(p.budget) || 0;
          const actual = Number(p.actualCost) || 0;
          const variance = budget - actual;
          return {
            'Project Code': p.projectCode || 'PRJ-000',
            'Project Name': p.name,
            'Allocated Budget': `$${budget.toLocaleString()}`,
            'Actual Cost Incurred': `$${actual.toLocaleString()}`,
            'Variance ($)': `$${variance.toLocaleString()}`,
            'Margin Health': variance >= 0 ? 'Within Budget' : 'Over Budget (Cost Overrun)',
          };
        });
        break;

      case 'budget_utilization':
        reportTitle = 'Budget Utilization % Report';
        rows = filteredProjects.map((p) => {
          const budget = Number(p.budget) || 0;
          const actual = Number(p.actualCost) || 0;
          const util = budget > 0 ? Math.round((actual / budget) * 100) : 0;
          return {
            'Project Code': p.projectCode || 'PRJ-000',
            'Project Name': p.name,
            'Budget': `$${budget.toLocaleString()}`,
            'Actual Cost': `$${actual.toLocaleString()}`,
            'Utilization %': `${util}%`,
            'Burn Rate': util > 100 ? 'Exceeded' : util > 80 ? 'High' : 'Normal',
            'Status': p.status,
          };
        });
        break;

      case 'planned_vs_actual':
        reportTitle = 'Planned vs Actual Financials Report';
        rows = filteredProjects.map((p) => {
          const budget = Number(p.budget) || 0;
          const planned = Number(p.plannedCost || p.budget) || 0;
          const actual = Number(p.actualCost) || 0;
          const planHrs = Number(p.budgetedHours) || 0;
          const actHrs = Number(p.actualHours) || 0;
          return {
            'Project Code': p.projectCode || 'PRJ-000',
            'Project Name': p.name,
            'Planned Cost': `$${planned.toLocaleString()}`,
            'Actual Cost': `$${actual.toLocaleString()}`,
            'Cost Variance': `$${(planned - actual).toLocaleString()}`,
            'Planned Hours': `${planHrs} hrs`,
            'Actual Hours': `${actHrs} hrs`,
            'Hours Variance': `${planHrs - actHrs} hrs`,
          };
        });
        break;

      // ----------------------------------------------------
      // Category 5: ISSUE & DEFECT REPORTS
      // ----------------------------------------------------
      case 'open_issues':
        reportTitle = 'Open Defect & Issue Register';
        filteredProjects.forEach((p) => {
          (p.issues || [])
            .filter((i) => !['Closed', 'Resolved'].includes(i.status))
            .forEach((iss) => {
              rows.push({
                'Issue ID': iss.issueId || 'ISS-00',
                'Title': iss.title,
                'Project': p.name,
                'Severity': iss.severity || 'Medium',
                'Priority': iss.priority || 'Medium',
                'Status': iss.status || 'Open',
                'Assigned To': iss.assignedTo || 'Unassigned',
                'Reported By': iss.reportedBy || 'Team Member',
                'Due Date': iss.dueDate ? new Date(iss.dueDate).toISOString().slice(0, 10) : '—',
              });
            });
        });
        break;

      case 'severity':
      case 'issue-severity':
        reportTitle = 'Issues by Severity & Impact Report';
        filteredProjects.forEach((p) => {
          (p.issues || []).forEach((iss) => {
            rows.push({
              'Issue ID': iss.issueId || 'ISS-00',
              'Title': iss.title,
              'Severity': iss.severity || 'Medium',
              'Impact Tier': ['Critical', 'High'].includes(iss.severity) ? 'High Priority Bug' : 'Standard Defect',
              'Project': p.name,
              'Status': iss.status || 'Open',
              'Assigned To': iss.assignedTo || 'Unassigned',
              'Reported Date': iss.createdAt ? new Date(iss.createdAt).toISOString().slice(0, 10) : '—',
            });
          });
        });
        break;

      case 'issue_assignee':
        reportTitle = 'Assignee-wise Bug Resolution Report';
        const issAssigneeMap = {};
        filteredProjects.forEach((p) => {
          (p.issues || []).forEach((iss) => {
            const assignee = iss.assignedTo || 'Unassigned';
            if (!issAssigneeMap[assignee]) {
              issAssigneeMap[assignee] = {
                'Assignee Name': assignee,
                'Open Defects': 0,
                'Resolved Defects': 0,
                'Total Assigned': 0,
              };
            }
            issAssigneeMap[assignee]['Total Assigned'] += 1;
            if (['Closed', 'Resolved'].includes(iss.status)) issAssigneeMap[assignee]['Resolved Defects'] += 1;
            else issAssigneeMap[assignee]['Open Defects'] += 1;
          });
        });
        rows = Object.values(issAssigneeMap).map((a) => ({
          ...a,
          'Resolution Rate': `${a['Total Assigned'] > 0 ? Math.round((a['Resolved Defects'] / a['Total Assigned']) * 100) : 0}%`,
        }));
        break;

      case 'resolution_time':
        reportTitle = 'Closed Issues & Resolution Log';
        filteredProjects.forEach((p) => {
          (p.issues || [])
            .filter((i) => ['Closed', 'Resolved'].includes(i.status))
            .forEach((iss) => {
              rows.push({
                'Issue ID': iss.issueId || 'ISS-00',
                'Title': iss.title,
                'Project': p.name,
                'Severity': iss.severity || 'Medium',
                'Status': iss.status,
                'Closed On': iss.updatedAt ? new Date(iss.updatedAt).toISOString().slice(0, 10) : '—',
                'Resolution Note': iss.resolution || 'Resolved as expected',
              });
            });
        });
        break;

      default:
        reportTitle = 'Comprehensive Projects Portfolio Report';
        rows = filteredProjects.map((p) => ({
          'Project Code': p.projectCode || 'PRJ-000',
          'Project Name': p.name,
          'Client': p.clientName || 'Internal',
          'Category': p.category || 'General',
          'Status': p.status || 'Planning',
          'Priority': p.priority || 'Medium',
          'Progress': `${p.progress || 0}%`,
          'Budget': `${p.currency || 'USD'} ${Number(p.budget || 0).toLocaleString()}`,
          'Manager': p.managerName || 'Unassigned',
          'Created Date': p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '—',
        }));
        break;
    }

    return res.json({
      success: true,
      reportType,
      title: reportTitle,
      recordsCount: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error('[Project Report Error]', err);
    res.status(500).json({ success: false, message: 'Failed to generate report', error: err.message });
  }
});

// ==========================================
// 4. Excel / CSV Export (Separate Endpoint)
// ==========================================
// @route   POST /api/projects/excel/export
// @desc    Export scoped projects as Excel (.xlsx) or CSV with audit trail
// @access  Private
router.post('/excel/export', async (req, res) => {
  try {
    const { format = 'xlsx', status = 'all', priority = 'all', category = 'all' } = req.body;
    const { projectsList } = await getScopedProjectsAndUsers(req.user);

    let filtered = projectsList;
    if (status !== 'all') filtered = filtered.filter((p) => p.status === status);
    if (priority !== 'all') filtered = filtered.filter((p) => p.priority === priority);
    if (category !== 'all') filtered = filtered.filter((p) => p.category === category);

    const rows = filtered.map((p) => ({
      'Project Code': p.projectCode || 'PRJ-000',
      'Project Name': p.name || '',
      'Client Name': p.clientName || '',
      'Category': p.category || '',
      'Project Type': p.projectType || 'Client Deliverable',
      'Status': p.status || 'Planning',
      'Priority': p.priority || 'Medium',
      'Progress %': `${p.progress || 0}%`,
      'Total Budget': Number(p.budget) || 0,
      'Actual Cost': Number(p.actualCost) || 0,
      'Currency': p.currency || 'USD',
      'Billing Type': p.billingType || 'Fixed Cost',
      'Start Date': p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : '',
      'Target Completion Date': p.targetDate ? new Date(p.targetDate).toISOString().slice(0, 10) : '',
      'Project Manager': p.managerName || p.projectManager || 'Unassigned',
      'Project Owner': p.ownerName || p.projectOwner || 'Unassigned',
      'Milestones Count': (p.milestones || []).length,
      'Tasks Count': (p.tasks || []).length,
      'Open Issues': (p.issues || []).filter((i) => i.status !== 'Closed').length,
      'Created Date': new Date(p.createdAt).toISOString().slice(0, 10),
    }));

    const filename = `Projects_Export_${new Date().toISOString().slice(0, 10)}`;

    await logAuditAction({
      entity_type: 'Project',
      entity_id: 'ALL',
      action: 'EXPORT_EXCEL',
      operator: req.user,
      delta: `Exported ${rows.length} projects records (${format.toUpperCase()})`,
      req,
    });

    if (format === 'csv') {
      const ws = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.status(200).send('\uFEFF' + csv);
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Projects');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('[Export Projects Error]', err);
    res.status(500).json({ success: false, message: 'Export failed', error: err.message });
  }
});

// ==========================================
// 5. Excel / File Import Preview & Execute
// ==========================================
// @route   POST /api/projects/excel/preview
// @desc    Parse uploaded file data for preview & field mapping
// @access  Private
router.post('/excel/preview', async (req, res) => {
  try {
    const { fileData, fileName } = req.body;
    if (!fileData) {
      return res.status(400).json({ success: false, message: 'File payload is required' });
    }

    const base64Content = fileData.includes('base64,') ? fileData.split('base64,')[1] : fileData;
    const buffer = Buffer.from(base64Content, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'The uploaded file is empty' });
    }

    const headers = Object.keys(rawRows[0] || {});
    const previewRows = rawRows.slice(0, 15);

    return res.json({
      success: true,
      fileName,
      totalRows: rawRows.length,
      headers,
      previewRows,
      allRows: rawRows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to preview file', error: err.message });
  }
});

// @route   POST /api/projects/excel/import
// @desc    Execute mapped import with validation and hierarchy checks
// @access  Private
router.post('/excel/import', async (req, res) => {
  try {
    const { rows = [], fieldMapping = {} } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows to import' });
    }

    let existingProjects = [];
    let allUsers = [];

    if (fallbackStore.isFallback) {
      existingProjects = fallbackStore.projects || [];
      allUsers = fallbackStore.users || [];
    } else {
      existingProjects = await Project.find({}).lean();
      allUsers = await User.find({}).lean();
    }

    let importedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    const errors = [];
    const createdProjects = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      const name = (row[fieldMapping.name || 'Project Name'] || row.name || row['Project Name'] || '').trim();
      const clientName = (row[fieldMapping.clientName || 'Client Name'] || row.clientName || row['Client Name'] || '').trim();

      if (!name || !clientName) {
        failedCount++;
        errors.push({ row: rowNum, message: 'Project Name and Client Name are required.' });
        continue;
      }

      // Check duplicate by name + client
      const isDuplicate = existingProjects.some(
        (p) => p.name.toLowerCase() === name.toLowerCase() && p.clientName.toLowerCase() === clientName.toLowerCase()
      );

      if (isDuplicate) {
        duplicateCount++;
        continue;
      }

      const budgetVal = Number(row[fieldMapping.budget || 'Total Budget'] || row.budget || 0) || 0;
      const targetDateVal = row[fieldMapping.targetDate || 'Target Completion Date'] || row.targetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const managerNameVal = (row[fieldMapping.managerName || 'Project Manager'] || row.managerName || req.user.name || 'Unassigned').trim();
      const priorityVal = row[fieldMapping.priority || 'Priority'] || row.priority || 'Medium';
      const categoryVal = row[fieldMapping.category || 'Category'] || row.category || 'Web Application';

      const projectCode = generateProjectCode(existingProjects.concat(createdProjects));

      const newProj = {
        _id: fallbackStore.isFallback ? `prj_${Date.now()}_${Math.floor(Math.random() * 10000)}` : undefined,
        projectCode,
        name,
        clientName,
        client: clientName,
        description: (row[fieldMapping.description || 'Description'] || row.description || '').trim(),
        category: categoryVal,
        projectType: 'Client Deliverable',
        status: 'Planning',
        priority: priorityVal,
        budget: budgetVal,
        currency: 'USD',
        startDate: new Date().toISOString(),
        targetDate: new Date(targetDateVal).toISOString(),
        progress: 0,
        managerName: managerNameVal,
        projectManager: managerNameVal,
        ownerName: managerNameVal,
        projectOwner: managerNameVal,
        teamMembers: [],
        phases: [
          { phaseId: 'PH-01', name: 'Planning & Setup', order: 1, status: 'In Progress', progress: 0 },
          { phaseId: 'PH-02', name: 'Execution & QA', order: 2, status: 'Upcoming', progress: 0 },
        ],
        milestones: [
          { milestoneId: 'MS-01', title: 'Project Initiation & Kickoff', isCompleted: false, status: 'Upcoming' },
          { milestoneId: 'MS-02', title: 'Final Deliverable Sign-off', isCompleted: false, status: 'Upcoming' },
        ],
        tasks: [],
        issues: [],
        risks: [],
        timesheets: [],
        documents: [],
        comments: [],
        activityHistory: [
          {
            eventId: `evt_${Date.now()}`,
            action: 'IMPORTED',
            description: `Imported via Bulk Upload by ${req.user.name}`,
            performedBy: req.user._id ? req.user._id.toString() : 'SYSTEM',
            performedByName: req.user.name,
            timestamp: new Date(),
          },
        ],
        createdBy: req.user._id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (fallbackStore.isFallback) {
        if (!fallbackStore.projects) fallbackStore.projects = [];
        fallbackStore.projects.unshift(newProj);
        createdProjects.push(newProj);
        importedCount++;
      } else {
        const created = await Project.create(newProj);
        createdProjects.push(created.toObject());
        importedCount++;
      }
    }

    if (fallbackStore.isFallback) {
      fallbackStore.saveToFile();
    }

    await logAuditAction({
      entity_type: 'Project',
      entity_id: 'IMPORT_BATCH',
      action: 'IMPORT_EXCEL',
      operator: req.user,
      delta: `Import summary: ${importedCount} created, ${duplicateCount} duplicates, ${failedCount} errors`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('project_created', createdProjects[0] || {});
    }

    return res.json({
      success: true,
      summary: {
        totalRows: rows.length,
        importedCount,
        duplicateCount,
        failedCount,
        errors,
      },
    });
  } catch (err) {
    console.error('[Import Projects Error]', err);
    res.status(500).json({ success: false, message: 'Import execution failed', error: err.message });
  }
});

// ==========================================
// 6. Project List & Multi-Filter Query
// ==========================================
// @route   GET /api/projects
// @desc    Get all projects with multi-filter, search, pagination, and stats
// @access  Private
router.get('/', async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      priority = 'all',
      category = 'all',
      manager = 'all',
      dateFilter = 'all',
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageLimit = Math.max(1, parseInt(limit, 10));

    const { projectsList, allUsers } = await getScopedProjectsAndUsers(req.user);

    // Global Stats before filters
    const totalBudget = projectsList.reduce((acc, p) => acc + (Number(p.budget) || 0), 0);
    const avgProgress =
      projectsList.length > 0
        ? Math.round(projectsList.reduce((acc, p) => acc + (Number(p.progress) || 0), 0) / projectsList.length)
        : 0;

    const stats = {
      total: projectsList.length,
      planning: projectsList.filter((p) => p.status === 'Planning').length,
      inProgress: projectsList.filter((p) => p.status === 'In Progress').length,
      completed: projectsList.filter((p) => p.status === 'Completed' || p.status === 'Closed').length,
      onHold: projectsList.filter((p) => p.status === 'On Hold').length,
      totalBudget,
      avgProgress,
    };

    // Apply filters
    let filtered = projectsList;

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        (p) =>
          (p.projectCode && p.projectCode.toLowerCase().includes(q)) ||
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.clientName && p.clientName.toLowerCase().includes(q)) ||
          (p.client && p.client.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          (p.managerName && p.managerName.toLowerCase().includes(q)) ||
          (p.projectManager && p.projectManager.toLowerCase().includes(q)) ||
          (p.ownerName && p.ownerName.toLowerCase().includes(q)) ||
          (p.projectOwner && p.projectOwner.toLowerCase().includes(q)) ||
          (p.category && p.category.toLowerCase().includes(q))
      );
    }

    if (status && status !== 'all') {
      if (status === 'On Track') {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        filtered = filtered.filter((p) => {
          if (p.health === 'On Track') return true;
          if (['Completed', 'Closed'].includes(p.status)) return true;
          const target = p.targetDate ? new Date(p.targetDate) : null;
          const isOverdue = target && target < now;
          const isCancelled = p.status === 'Cancelled';
          const isOnHold = p.status === 'On Hold';
          const isHighRisk = ['Critical', 'Urgent', 'High'].includes(p.priority) || p.status === 'Under Review';
          const isNearDeadline =
            target &&
            Math.ceil((target - now) / (1000 * 60 * 60 * 24)) <= 7 &&
            Math.ceil((target - now) / (1000 * 60 * 60 * 24)) >= 0;
          return !isOverdue && !isCancelled && !isOnHold && !isHighRisk && !isNearDeadline && p.status !== 'Delayed' && p.status !== 'Overdue';
        });
      } else if (status === 'At Risk') {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        filtered = filtered.filter((p) => {
          if (p.health === 'At Risk') return true;
          if (['Completed', 'Closed'].includes(p.status)) return false;
          const target = p.targetDate ? new Date(p.targetDate) : null;
          const isOverdue = target && target < now;
          if (isOverdue || p.status === 'Cancelled' || p.status === 'Delayed' || p.status === 'Overdue') return false;
          const isHighRisk = ['Critical', 'Urgent', 'High'].includes(p.priority) || p.status === 'Under Review';
          const isNearDeadline =
            target &&
            Math.ceil((target - now) / (1000 * 60 * 60 * 24)) <= 7 &&
            Math.ceil((target - now) / (1000 * 60 * 60 * 24)) >= 0;
          return p.status === 'On Hold' || isHighRisk || isNearDeadline || p.status === 'At Risk';
        });
      } else if (status === 'Delayed') {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        filtered = filtered.filter((p) => {
          if (p.health === 'Delayed') return true;
          if (['Completed', 'Closed'].includes(p.status)) return false;
          const target = p.targetDate ? new Date(p.targetDate) : null;
          const isOverdue = target && target < now;
          return isOverdue || p.status === 'Cancelled' || p.status === 'Delayed' || p.status === 'Overdue';
        });
      } else if (status === 'Completed' || status === 'Delivered') {
        filtered = filtered.filter((p) => ['Completed', 'Closed', 'Delivered'].includes(p.status));
      } else {
        filtered = filtered.filter((p) => p.status === status);
      }
    }

    if (priority && priority !== 'all') {
      filtered = filtered.filter((p) => p.priority === priority);
    }

    if (category && category !== 'all') {
      filtered = filtered.filter((p) => p.category === category);
    }

    if (manager && manager !== 'all') {
      const mgrQuery = manager.toLowerCase().trim();
      filtered = filtered.filter(
        (p) =>
          (p.managerName && p.managerName.toLowerCase().includes(mgrQuery)) ||
          (p.projectManager && p.projectManager.toLowerCase().includes(mgrQuery)) ||
          (p.ownerName && p.ownerName.toLowerCase().includes(mgrQuery)) ||
          (p.projectOwner && p.projectOwner.toLowerCase().includes(mgrQuery)) ||
          (Array.isArray(p.teamMembers) && p.teamMembers.some((tm) => tm.name && tm.name.toLowerCase().includes(mgrQuery)))
      );
    }

    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      filtered = filtered.filter((p) => {
        if (!p.targetDate) return false;
        const target = new Date(p.targetDate);
        if (isNaN(target.getTime())) return false;

        if (dateFilter === 'overdue') {
          return target < now && p.status !== 'Completed' && p.status !== 'Closed';
        }
        if (dateFilter === 'due_this_month') {
          return target.getFullYear() === currentYear && target.getMonth() === currentMonth;
        }
        if (dateFilter === 'due_next_month') {
          const nextMonth = new Date(currentYear, currentMonth + 1, 1);
          return target.getFullYear() === nextMonth.getFullYear() && target.getMonth() === nextMonth.getMonth();
        }
        if (dateFilter === 'completed') {
          return p.status === 'Completed' || p.status === 'Closed';
        }
        return true;
      });
    }

    // Pagination
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / pageLimit) || 1;
    const startIndex = (pageNum - 1) * pageLimit;
    const paginatedProjects = filtered.slice(startIndex, startIndex + pageLimit);

    return res.json({
      success: true,
      projects: paginatedProjects,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: pageLimit,
        totalPages,
      },
      stats,
    });
  } catch (err) {
    console.error('[Get Projects Error]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch projects', error: err.message });
  }
});

// ==========================================
// 7. Get Single Project Details
// ==========================================
// @route   GET /api/projects/:id
// @desc    Get single project details with complete sub-entities
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    let project;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      project = (fallbackStore.projects || []).find((p) => p._id.toString() === req.params.id);
      allUsers = fallbackStore.users || [];
    } else {
      project = await Project.findById(req.params.id);
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const projectObj = typeof project.toObject === 'function' ? project.toObject() : project;

    if (!canUserAccessProject(req.user, projectObj, allUsers)) {
      return res.status(403).json({ success: false, message: 'You do not have access to view this project' });
    }

    return res.json({ success: true, project: projectObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error retrieving project', error: err.message });
  }
});

// ==========================================
// 8. Create Project (With Template support)
// ==========================================
// @route   POST /api/projects
// @desc    Create a new project
// @access  Private
router.post('/', async (req, res) => {
  try {
    const {
      name,
      title,
      clientName,
      client,
      clientId,
      leadId,
      opportunityId,
      description = '',
      category = 'Web Application',
      projectType = 'Client Deliverable',
      department = 'Engineering & Operations',
      priority = 'Medium',
      status = 'Planning',
      budget = 0,
      plannedCost = 0,
      budgetedHours = 0,
      currency = 'USD',
      billingType = 'Fixed Cost',
      billingMethod = 'Milestone Based',
      estimatedCost = 0,
      startDate,
      targetDate,
      owner,
      ownerName,
      projectOwner,
      manager = null,
      managerName,
      projectManager,
      teamMembers = [],
      phases = [],
      milestones = [],
      tasks = [],
      templateId = null,
    } = req.body;

    const finalClientName = (clientName || client || '').trim();
    const projectName = (name || title || '').trim();
    if (!projectName || !finalClientName) {
      return res.status(400).json({
        success: false,
        message: 'Project name and client name are required.',
      });
    }

    // Validation: Start Date & End Date
    const finalStartDate = startDate ? new Date(startDate) : new Date();
    const finalTargetDate = targetDate ? new Date(targetDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (finalTargetDate < finalStartDate) {
      return res.status(400).json({
        success: false,
        message: 'Target completion date cannot be earlier than project start date.',
      });
    }

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role').lean();
    }

    // Resolve Manager & Owner with Fallbacks
    const resolvedManagerName = (managerName && managerName !== 'Unassigned' ? managerName : projectManager) || req.user.name || 'Unassigned';
    let resolvedManagerId = manager || null;
    if (!resolvedManagerId && resolvedManagerName && resolvedManagerName !== 'Unassigned') {
      const matched = allUsers.find(
        (u) => (u.name && u.name.toLowerCase() === resolvedManagerName.toLowerCase()) ||
               (u.username && u.username.toLowerCase() === resolvedManagerName.toLowerCase())
      );
      if (matched) resolvedManagerId = (matched._id || matched.id);
    }

    const resolvedOwnerName = (ownerName && ownerName !== 'Unassigned' ? ownerName : projectOwner) || req.user.name || 'Unassigned';
    let resolvedOwnerId = owner || null;
    if (!resolvedOwnerId && resolvedOwnerName && resolvedOwnerName !== 'Unassigned') {
      const matched = allUsers.find(
        (u) => (u.name && u.name.toLowerCase() === resolvedOwnerName.toLowerCase()) ||
               (u.username && u.username.toLowerCase() === resolvedOwnerName.toLowerCase())
      );
      if (matched) resolvedOwnerId = (matched._id || matched.id);
    }

    let initialPhases = phases && phases.length > 0 ? phases : [];
    let initialMilestones = milestones && milestones.length > 0 ? milestones : [];
    let initialTasks = tasks && tasks.length > 0 ? tasks : [];

    // Template application if selected
    if (templateId) {
      const tpl = PROJECT_TEMPLATES.find((t) => t.templateId === templateId);
      if (tpl) {
        if (initialPhases.length === 0) initialPhases = tpl.phases;
        if (initialMilestones.length === 0) initialMilestones = tpl.milestones;
        if (initialTasks.length === 0) initialTasks = tpl.tasks;
      }
    }

    // Default starter milestones if still empty
    if (initialMilestones.length === 0) {
      initialMilestones = [
        { milestoneId: 'MS-01', title: 'Project Kickoff & Scope Alignment', isCompleted: true, completedAt: new Date().toISOString(), status: 'Completed', weight: 1 },
        { milestoneId: 'MS-02', title: 'Architecture & Design Approval', isCompleted: false, status: 'Upcoming', weight: 1 },
        { milestoneId: 'MS-03', title: 'Core Implementation & QA Testing', isCompleted: false, status: 'Upcoming', weight: 2 },
        { milestoneId: 'MS-04', title: 'Final Handover & Client Sign-off', isCompleted: false, status: 'Upcoming', weight: 1 },
      ];
    }

    if (initialPhases.length === 0) {
      initialPhases = [
        { phaseId: 'PH-01', name: 'Planning & Design', order: 1, status: 'In Progress', progress: 50 },
        { phaseId: 'PH-02', name: 'Implementation & QA', order: 2, status: 'Upcoming', progress: 0 },
        { phaseId: 'PH-03', name: 'Deployment & Sign-off', order: 3, status: 'Upcoming', progress: 0 },
      ];
    }

    const completedM = initialMilestones.filter((m) => m.isCompleted || m.status === 'Completed').length;
    const progress = Math.round((completedM / initialMilestones.length) * 100);

    const initialActivity = [
      {
        eventId: `evt_${Date.now()}`,
        action: 'CREATED',
        description: `Project registered in workspace by ${req.user.name}`,
        performedBy: req.user._id ? req.user._id.toString() : 'SYSTEM',
        performedByName: req.user.name,
        performedRole: req.user.role || 'User',
        timestamp: new Date(),
        delta: `Created project ${projectName} for client ${finalClientName}`,
      },
    ];

    let newProject;
    if (fallbackStore.isFallback) {
      const projectCode = generateProjectCode(fallbackStore.projects || []);
      newProject = {
        _id: 'prj_' + Date.now(),
        projectCode,
        name: projectName,
        clientName: finalClientName,
        client: finalClientName,
        clientId: clientId || null,
        leadId: leadId || '',
        opportunityId: opportunityId || '',
        description: description.trim(),
        category,
        projectType,
        department,
        status: status || (progress === 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Planning'),
        priority,
        budget: Number(budget) || 0,
        plannedCost: Number(plannedCost || budget) || 0,
        actualCost: 0,
        budgetedHours: Number(budgetedHours) || 0,
        actualHours: 0,
        currency,
        billingType,
        billingMethod,
        estimatedCost: Number(estimatedCost) || 0,
        startDate: finalStartDate.toISOString(),
        targetDate: finalTargetDate.toISOString(),
        progress,
        owner: resolvedOwnerId,
        ownerName: resolvedOwnerName,
        projectOwner: resolvedOwnerName,
        manager: resolvedManagerId,
        managerName: resolvedManagerName,
        projectManager: resolvedManagerName,
        teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
        phases: initialPhases,
        milestones: initialMilestones,
        tasks: initialTasks,
        issues: [],
        risks: [],
        timesheets: [],
        documents: Array.isArray(req.body.documents) ? req.body.documents : [],
        attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
        comments: [],
        activityHistory: initialActivity,
        approvals: [],
        createdBy: req.user._id ? req.user._id.toString() : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (!fallbackStore.projects) fallbackStore.projects = [];
      fallbackStore.projects.unshift(newProject);
      fallbackStore.saveToFile();
    } else {
      const allCount = await Project.countDocuments();
      const projectCode = `PRJ-${(allCount + 1).toString().padStart(4, '0')}`;

      newProject = await Project.create({
        projectCode,
        name: projectName,
        clientName: finalClientName,
        client: finalClientName,
        clientId: clientId || null,
        leadId: leadId || '',
        opportunityId: opportunityId || '',
        description: description.trim(),
        category,
        projectType,
        department,
        status: status || (progress === 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Planning'),
        priority,
        budget: Number(budget) || 0,
        plannedCost: Number(plannedCost || budget) || 0,
        actualCost: 0,
        budgetedHours: Number(budgetedHours) || 0,
        actualHours: 0,
        currency,
        billingType,
        billingMethod,
        estimatedCost: Number(estimatedCost) || 0,
        startDate: finalStartDate,
        targetDate: finalTargetDate,
        progress,
        owner: resolvedOwnerId,
        ownerName: resolvedOwnerName,
        projectOwner: resolvedOwnerName,
        manager: resolvedManagerId,
        managerName: resolvedManagerName,
        projectManager: resolvedManagerName,
        teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
        phases: initialPhases,
        milestones: initialMilestones,
        tasks: initialTasks,
        issues: [],
        risks: [],
        timesheets: [],
        documents: Array.isArray(req.body.documents) ? req.body.documents : [],
        attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
        comments: [],
        activityHistory: initialActivity,
        approvals: [],
        createdBy: req.user._id,
      });
      newProject = newProject.toObject();
    }

    await logAuditAction({
      entity_type: 'Project',
      entity_id: newProject._id,
      action: 'CREATE',
      operator: req.user,
      delta: `Created project ${newProject.name} (${newProject.projectCode})`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('project_created', newProject);
      io.emit('notification', {
        type: 'project_created',
        title: `New Project: ${newProject.name}`,
        message: `${newProject.clientName} - Budget: ${newProject.currency} ${newProject.budget}`,
        timestamp: new Date(),
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: newProject,
    });
  } catch (err) {
    console.error('[Create Project Error]', err);
    res.status(500).json({ success: false, message: 'Failed to create project', error: err.message });
  }
});

// ==========================================
// 9. Update Project Details
// ==========================================
// @route   PUT /api/projects/:id
// @desc    Update project details
// @access  Private
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      clientName,
      client,
      clientId,
      leadId,
      opportunityId,
      description,
      category,
      projectType,
      department,
      status,
      priority,
      budget,
      plannedCost,
      actualCost,
      budgetedHours,
      actualHours,
      currency,
      billingType,
      billingMethod,
      estimatedCost,
      startDate,
      targetDate,
      actualStartDate,
      actualEndDate,
      progress,
      owner,
      ownerName,
      projectOwner,
      manager,
      managerName,
      projectManager,
      teamMembers,
      phases,
      milestones,
      tasks,
      issues,
      risks,
      timesheets,
      documents,
      attachments,
    } = req.body;

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    let updatedProject;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      const existing = fallbackStore.projects[index];
      if (!canUserModifyProject(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to edit this project' });
      }

      let newMilestones = milestones !== undefined ? milestones : existing.milestones;
      let newProgress = progress !== undefined ? Number(progress) : existing.progress;

      if (milestones && milestones.length > 0) {
        const completed = milestones.filter((m) => m.isCompleted || m.status === 'Completed').length;
        newProgress = Math.round((completed / milestones.length) * 100);
      }

      // Resolve Manager
      let finalManagerName = existing.managerName || existing.projectManager || 'Unassigned';
      if (managerName !== undefined && managerName !== '') finalManagerName = managerName;
      else if (projectManager !== undefined && projectManager !== '') finalManagerName = projectManager;

      let finalManagerId = manager !== undefined ? manager : existing.manager;
      if (finalManagerName && finalManagerName !== 'Unassigned') {
        const matched = allUsers.find(
          (u) => (u.name && u.name.toLowerCase() === finalManagerName.toLowerCase()) ||
                 (u.username && u.username.toLowerCase() === finalManagerName.toLowerCase())
        );
        if (matched) finalManagerId = (matched._id || matched.id);
      }

      // Resolve Owner
      let finalOwnerName = existing.ownerName || existing.projectOwner || 'Unassigned';
      if (ownerName !== undefined && ownerName !== '') finalOwnerName = ownerName;
      else if (projectOwner !== undefined && projectOwner !== '') finalOwnerName = projectOwner;

      let finalOwnerId = owner !== undefined ? owner : existing.owner;
      if (finalOwnerName && finalOwnerName !== 'Unassigned') {
        const matched = allUsers.find(
          (u) => (u.name && u.name.toLowerCase() === finalOwnerName.toLowerCase()) ||
                 (u.username && u.username.toLowerCase() === finalOwnerName.toLowerCase())
        );
        if (matched) finalOwnerId = (matched._id || matched.id);
      }

      const finalClient = clientName !== undefined ? clientName : client !== undefined ? client : existing.clientName || existing.client;

      const updated = {
        ...existing,
        name: name !== undefined ? name : existing.name,
        clientName: finalClient,
        client: finalClient,
        clientId: clientId !== undefined ? clientId : existing.clientId,
        leadId: leadId !== undefined ? leadId : existing.leadId,
        opportunityId: opportunityId !== undefined ? opportunityId : existing.opportunityId,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        projectType: projectType !== undefined ? projectType : existing.projectType,
        department: department !== undefined ? department : existing.department,
        status: status !== undefined ? status : newProgress === 100 ? 'Completed' : existing.status,
        priority: priority !== undefined ? priority : existing.priority,
        budget: budget !== undefined ? Number(budget) : existing.budget,
        plannedCost: plannedCost !== undefined ? Number(plannedCost) : existing.plannedCost,
        actualCost: actualCost !== undefined ? Number(actualCost) : existing.actualCost,
        budgetedHours: budgetedHours !== undefined ? Number(budgetedHours) : existing.budgetedHours,
        actualHours: actualHours !== undefined ? Number(actualHours) : existing.actualHours,
        currency: currency !== undefined ? currency : existing.currency,
        billingType: billingType !== undefined ? billingType : existing.billingType,
        billingMethod: billingMethod !== undefined ? billingMethod : existing.billingMethod,
        estimatedCost: estimatedCost !== undefined ? Number(estimatedCost) : existing.estimatedCost,
        startDate: startDate !== undefined ? startDate : existing.startDate,
        targetDate: targetDate !== undefined ? targetDate : existing.targetDate,
        actualStartDate: actualStartDate !== undefined ? actualStartDate : existing.actualStartDate,
        actualEndDate: actualEndDate !== undefined ? actualEndDate : existing.actualEndDate,
        progress: newProgress,
        owner: finalOwnerId,
        ownerName: finalOwnerName,
        projectOwner: finalOwnerName,
        manager: finalManagerId,
        managerName: finalManagerName,
        projectManager: finalManagerName,
        teamMembers: teamMembers !== undefined ? teamMembers : existing.teamMembers,
        phases: phases !== undefined ? phases : existing.phases,
        milestones: newMilestones,
        tasks: tasks !== undefined ? tasks : existing.tasks,
        issues: issues !== undefined ? issues : existing.issues,
        risks: risks !== undefined ? risks : existing.risks,
        timesheets: timesheets !== undefined ? timesheets : existing.timesheets,
        documents: documents !== undefined ? documents : (existing.documents || []),
        attachments: attachments !== undefined ? attachments : (existing.attachments || []),
        updatedAt: new Date().toISOString(),
      };

      // Add to activity history
      if (!updated.activityHistory) updated.activityHistory = [];
      updated.activityHistory.unshift({
        eventId: `evt_${Date.now()}`,
        action: 'UPDATED',
        description: `Project details updated by ${req.user.name}`,
        performedBy: req.user._id ? req.user._id.toString() : 'SYSTEM',
        performedByName: req.user.name,
        performedRole: req.user.role || 'User',
        timestamp: new Date(),
      });

      fallbackStore.projects[index] = updated;
      fallbackStore.saveToFile();
      updatedProject = updated;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      if (!canUserModifyProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to edit this project' });
      }

      // Resolve Manager
      let finalManagerName = project.managerName || project.projectManager || 'Unassigned';
      if (managerName !== undefined && managerName !== '') finalManagerName = managerName;
      else if (projectManager !== undefined && projectManager !== '') finalManagerName = projectManager;

      let finalManagerId = manager !== undefined ? manager : project.manager;
      if (finalManagerName && finalManagerName !== 'Unassigned') {
        const matched = allUsers.find(
          (u) => (u.name && u.name.toLowerCase() === finalManagerName.toLowerCase()) ||
                 (u.username && u.username.toLowerCase() === finalManagerName.toLowerCase())
        );
        if (matched) finalManagerId = (matched._id || matched.id);
      }

      // Resolve Owner
      let finalOwnerName = project.ownerName || project.projectOwner || 'Unassigned';
      if (ownerName !== undefined && ownerName !== '') finalOwnerName = ownerName;
      else if (projectOwner !== undefined && projectOwner !== '') finalOwnerName = projectOwner;

      let finalOwnerId = owner !== undefined ? owner : project.owner;
      if (finalOwnerName && finalOwnerName !== 'Unassigned') {
        const matched = allUsers.find(
          (u) => (u.name && u.name.toLowerCase() === finalOwnerName.toLowerCase()) ||
                 (u.username && u.username.toLowerCase() === finalOwnerName.toLowerCase())
        );
        if (matched) finalOwnerId = (matched._id || matched.id);
      }

      const finalClient = clientName !== undefined ? clientName : client !== undefined ? client : project.clientName || project.client;

      if (name !== undefined) project.name = name;
      if (finalClient !== undefined) {
        project.clientName = finalClient;
        project.client = finalClient;
      }
      if (clientId !== undefined) project.clientId = clientId;
      if (leadId !== undefined) project.leadId = leadId;
      if (opportunityId !== undefined) project.opportunityId = opportunityId;
      if (description !== undefined) project.description = description;
      if (category !== undefined) project.category = category;
      if (projectType !== undefined) project.projectType = projectType;
      if (department !== undefined) project.department = department;
      if (status !== undefined) project.status = status;
      if (priority !== undefined) project.priority = priority;
      if (budget !== undefined) project.budget = Number(budget);
      if (plannedCost !== undefined) project.plannedCost = Number(plannedCost);
      if (actualCost !== undefined) project.actualCost = Number(actualCost);
      if (budgetedHours !== undefined) project.budgetedHours = Number(budgetedHours);
      if (actualHours !== undefined) project.actualHours = Number(actualHours);
      if (currency !== undefined) project.currency = currency;
      if (billingType !== undefined) project.billingType = billingType;
      if (billingMethod !== undefined) project.billingMethod = billingMethod;
      if (estimatedCost !== undefined) project.estimatedCost = Number(estimatedCost);
      if (startDate !== undefined) project.startDate = startDate;
      if (targetDate !== undefined) project.targetDate = targetDate;
      if (actualStartDate !== undefined) project.actualStartDate = actualStartDate;
      if (actualEndDate !== undefined) project.actualEndDate = actualEndDate;
      project.owner = finalOwnerId;
      project.ownerName = finalOwnerName;
      project.projectOwner = finalOwnerName;
      project.manager = finalManagerId;
      project.managerName = finalManagerName;
      project.projectManager = finalManagerName;
      if (teamMembers !== undefined) project.teamMembers = teamMembers;
      if (phases !== undefined) project.phases = phases;
      if (milestones !== undefined) project.milestones = milestones;
      if (tasks !== undefined) project.tasks = tasks;
      if (issues !== undefined) project.issues = issues;
      if (risks !== undefined) project.risks = risks;
      if (timesheets !== undefined) project.timesheets = timesheets;
      if (documents !== undefined) project.documents = documents;
      if (attachments !== undefined) project.attachments = attachments;

      if (!project.activityHistory) project.activityHistory = [];
      project.activityHistory.unshift({
        eventId: `evt_${Date.now()}`,
        action: 'UPDATED',
        description: `Project details updated by ${req.user.name}`,
        performedBy: req.user._id,
        performedByName: req.user.name,
        performedRole: req.user.role || 'User',
        timestamp: new Date(),
      });

      await project.save();
      updatedProject = project.toObject();
    }

    await logAuditAction({
      entity_type: 'Project',
      entity_id: req.params.id,
      action: 'UPDATE',
      operator: req.user,
      delta: `Updated project ${updatedProject.name}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('project_updated', updatedProject);
    }

    return res.json({
      success: true,
      message: 'Project updated successfully',
      project: updatedProject,
    });
  } catch (err) {
    console.error('[Update Project Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update project', error: err.message });
  }
});

// ==========================================
// 10. Lifecycle Status Transitions
// ==========================================
// @route   PATCH /api/projects/:id/status
// @desc    Update project lifecycle status with validation
// @access  Private
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, remarks = '' } = req.body;
    const validStatuses = ['Draft', 'Planning', 'Approved', 'In Progress', 'Under Review', 'On Hold', 'Completed', 'Closed', 'Cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
    }

    let allUsers = [];
    if (fallbackStore.isFallback) allUsers = fallbackStore.users || [];
    else allUsers = await User.find({}).lean();

    let updatedProject;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (idx === -1) return res.status(404).json({ success: false, message: 'Project not found' });

      const project = fallbackStore.projects[idx];
      if (!canUserModifyProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized status transition' });
      }

      const priorStatus = project.status;
      project.status = status;
      if (status === 'Completed' || status === 'Closed') {
        project.progress = 100;
        project.actualEndDate = new Date().toISOString();
      }

      if (!project.activityHistory) project.activityHistory = [];
      project.activityHistory.unshift({
        eventId: `evt_${Date.now()}`,
        action: 'STATUS_CHANGE',
        description: `Lifecycle status moved from ${priorStatus} to ${status}. ${remarks}`,
        performedBy: req.user._id,
        performedByName: req.user.name,
        timestamp: new Date(),
      });

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[idx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!canUserModifyProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized status transition' });
      }

      const priorStatus = project.status;
      project.status = status;
      if (status === 'Completed' || status === 'Closed') {
        project.progress = 100;
        project.actualEndDate = new Date();
      }

      if (!project.activityHistory) project.activityHistory = [];
      project.activityHistory.unshift({
        eventId: `evt_${Date.now()}`,
        action: 'STATUS_CHANGE',
        description: `Lifecycle status moved from ${priorStatus} to ${status}. ${remarks}`,
        performedBy: req.user._id,
        performedByName: req.user.name,
        timestamp: new Date(),
      });

      await project.save();
      updatedProject = project.toObject();
    }

    await logAuditAction({
      entity_type: 'Project',
      entity_id: req.params.id,
      action: 'STATUS_CHANGE',
      operator: req.user,
      delta: `Changed status to ${status}`,
      req,
    });

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.json({ success: true, message: 'Status updated successfully', project: updatedProject });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update status', error: err.message });
  }
});

// ==========================================
// 11. Milestone Toggle / Status Management
// ==========================================
// @route   PUT /api/projects/:id/milestones/:index/toggle
// @desc    Toggle milestone completion by index (backward compatible)
// @access  Private
router.put('/:id/milestones/:index/toggle', async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    let updatedProject;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });

      const project = fallbackStore.projects[pIdx];
      if (!canUserAccessProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to update milestones for this project' });
      }

      if (!project.milestones || !project.milestones[idx]) {
        return res.status(404).json({ success: false, message: 'Milestone index not found' });
      }

      const targetMilestone = project.milestones[idx];
      targetMilestone.isCompleted = !targetMilestone.isCompleted;
      targetMilestone.status = targetMilestone.isCompleted ? 'Completed' : 'In Progress';
      targetMilestone.completedAt = targetMilestone.isCompleted ? new Date().toISOString() : null;

      const completed = project.milestones.filter((m) => m.isCompleted || m.status === 'Completed').length;
      project.progress = Math.round((completed / project.milestones.length) * 100);
      if (project.progress === 100) project.status = 'Completed';
      else if (project.progress > 0 && project.status === 'Planning') project.status = 'In Progress';

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      allUsers = await User.find({}).lean();
      const project = await Project.findById(req.params.id);
      if (!project || !project.milestones || !project.milestones[idx]) {
        return res.status(404).json({ success: false, message: 'Project or milestone not found' });
      }

      if (!canUserAccessProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to update milestones for this project' });
      }

      const target = project.milestones[idx];
      target.isCompleted = !target.isCompleted;
      target.status = target.isCompleted ? 'Completed' : 'In Progress';
      target.completedAt = target.isCompleted ? new Date() : null;

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.json({
      success: true,
      message: 'Milestone status updated',
      project: updatedProject,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to toggle milestone', error: err.message });
  }
});

// ==========================================
// 12. Project Tasks Management (CRUD & Status)
// ==========================================
// @route   POST /api/projects/:id/tasks
// @desc    Add a project deliverable task
// @access  Private
router.post('/:id/tasks', async (req, res) => {
  try {
    const { title, description = '', phaseId = '', phaseName = '', milestoneId = '', milestoneTitle = '', assignedTo = 'Unassigned', priority = 'Medium', status = 'To Do', estimatedHours = 0, dueDate = null, tags = [], dependencies = [], recurrence = { frequency: 'None' }, subtasks = [] } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }

    let allUsers = [];
    if (fallbackStore.isFallback) allUsers = fallbackStore.users || [];
    else allUsers = await User.find({}).lean();

    let updatedProject;

    const newTask = {
      taskId: `TSK-${Math.floor(100 + Math.random() * 900)}`,
      title: title.trim(),
      description: description.trim(),
      phaseId,
      phaseName,
      milestoneId,
      milestoneTitle,
      assignedTo: assignedTo || 'Unassigned',
      priority,
      status,
      startDate: new Date().toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      estimatedHours: Number(estimatedHours) || 0,
      actualHours: 0,
      progress: status === 'Completed' ? 100 : 0,
      tags: Array.isArray(tags) ? tags : [],
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      recurrence: recurrence || { frequency: 'None' },
      subtasks: Array.isArray(subtasks) ? subtasks : [],
      comments: [],
      attachments: [],
      createdAt: new Date().toISOString(),
    };

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!canUserModifyProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized to add task' });
      }

      if (!project.tasks) project.tasks = [];
      project.tasks.push(newTask);
      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!canUserModifyProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized to add task' });
      }

      if (!project.tasks) project.tasks = [];
      project.tasks.push(newTask);
      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.status(201).json({ success: true, message: 'Task created successfully', project: updatedProject, task: newTask });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create task', error: err.message });
  }
});

// @route   PATCH /api/projects/:id/tasks/:taskId/status
// @desc    Update task status (e.g. Kanban drag & drop)
// @access  Private
router.patch('/:id/tasks/:taskId/status', async (req, res) => {
  try {
    const { status, progress } = req.body;
    let allUsers = [];
    if (fallbackStore.isFallback) allUsers = fallbackStore.users || [];
    else allUsers = await User.find({}).lean();

    let updatedProject;

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!canUserAccessProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const task = (project.tasks || []).find((t) => t.taskId === req.params.taskId || t._id?.toString() === req.params.taskId);
      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

      if (status !== undefined) task.status = status;
      if (progress !== undefined) task.progress = Number(progress);
      else if (status === 'Completed') task.progress = 100;

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!canUserAccessProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      const task = project.tasks.find((t) => t.taskId === req.params.taskId || t._id?.toString() === req.params.taskId);
      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

      if (status !== undefined) task.status = status;
      if (progress !== undefined) task.progress = Number(progress);
      else if (status === 'Completed') task.progress = 100;

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.json({ success: true, message: 'Task status updated', project: updatedProject });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update task status', error: err.message });
  }
});

// ==========================================
// 13. Issues / Bug Management
// ==========================================
// @route   POST /api/projects/:id/issues
// @desc    Log a bug/issue for a project
// @access  Private
router.post('/:id/issues', async (req, res) => {
  try {
    const { title, description = '', phaseId = '', phaseName = '', milestoneId = '', taskId = '', priority = 'Medium', severity = 'Moderate', assignedTo = 'Unassigned', dueDate = null } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Issue title is required' });
    }

    let allUsers = [];
    if (fallbackStore.isFallback) allUsers = fallbackStore.users || [];
    else allUsers = await User.find({}).lean();

    let updatedProject;
    const newIssue = {
      issueId: `ISS-${Math.floor(100 + Math.random() * 900)}`,
      title: title.trim(),
      description: description.trim(),
      phaseId,
      phaseName,
      milestoneId,
      taskId,
      reportedBy: req.user.name || 'System',
      reportedById: req.user._id,
      assignedTo: assignedTo || 'Unassigned',
      priority,
      severity,
      status: 'Open',
      createdAt: new Date().toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      resolution: '',
    };

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!canUserAccessProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      if (!project.issues) project.issues = [];
      project.issues.unshift(newIssue);
      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!canUserAccessProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }

      if (!project.issues) project.issues = [];
      project.issues.unshift(newIssue);
      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.status(201).json({ success: true, message: 'Issue logged successfully', project: updatedProject, issue: newIssue });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to log issue', error: err.message });
  }
});

// @route   PATCH /api/projects/:id/issues/:issueId/status
// @desc    Change issue status (Open -> Assigned -> In Progress -> Resolved -> Closed)
// @access  Private
router.patch('/:id/issues/:issueId/status', async (req, res) => {
  try {
    const { status, resolution = '' } = req.body;
    let allUsers = [];
    if (fallbackStore.isFallback) allUsers = fallbackStore.users || [];
    else allUsers = await User.find({}).lean();

    let updatedProject;

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      const issue = (project.issues || []).find((i) => i.issueId === req.params.issueId || i._id?.toString() === req.params.issueId);
      if (!issue) return res.status(404).json({ success: false, message: 'Issue not found' });

      issue.status = status;
      if (resolution) issue.resolution = resolution;
      if (status === 'Resolved') issue.resolvedAt = new Date().toISOString();
      if (status === 'Closed') issue.closedAt = new Date().toISOString();

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      const issue = project.issues.find((i) => i.issueId === req.params.issueId || i._id?.toString() === req.params.issueId);
      if (!issue) return res.status(404).json({ success: false, message: 'Issue not found' });

      issue.status = status;
      if (resolution) issue.resolution = resolution;
      if (status === 'Resolved') issue.resolvedAt = new Date();
      if (status === 'Closed') issue.closedAt = new Date();

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.json({ success: true, message: 'Issue updated', project: updatedProject });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update issue', error: err.message });
  }
});

// ==========================================
// 14. Risk Management
// ==========================================
// @route   POST /api/projects/:id/risks
// @desc    Add a risk item to a project
// @access  Private
router.post('/:id/risks', async (req, res) => {
  try {
    const { title, description = '', probability = 'Medium', impact = 'Medium', riskLevel = 'Medium', owner = 'Unassigned', mitigationPlan = '', dueDate = null } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Risk title is required' });
    }

    let updatedProject;
    const newRisk = {
      riskId: `RSK-${Math.floor(100 + Math.random() * 900)}`,
      title: title.trim(),
      description: description.trim(),
      probability,
      impact,
      riskLevel,
      owner: owner || 'Unassigned',
      mitigationPlan: mitigationPlan.trim(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      status: 'Identified',
      createdAt: new Date().toISOString(),
    };

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!project.risks) project.risks = [];
      project.risks.unshift(newRisk);
      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!project.risks) project.risks = [];
      project.risks.unshift(newRisk);
      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.status(201).json({ success: true, message: 'Risk registered', project: updatedProject, risk: newRisk });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add risk', error: err.message });
  }
});

// ==========================================
// 15. Timesheets Management
// ==========================================
// @route   POST /api/projects/:id/timesheets
// @desc    Log timesheet entry
// @access  Private
router.post('/:id/timesheets', async (req, res) => {
  try {
    const { date, phaseId = '', phaseName = '', milestoneId = '', milestoneTitle = '', taskId = '', taskTitle = 'General Work', startTime = '09:00', endTime = '17:00', totalHours = 1, isBillable = true, notes = '' } = req.body;

    const hours = Number(totalHours) || 0;
    if (hours <= 0) {
      return res.status(400).json({ success: false, message: 'Total hours must be greater than 0' });
    }

    let updatedProject;
    const newTimesheet = {
      timesheetId: `TS-${Date.now()}`,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      phaseId,
      phaseName,
      milestoneId,
      milestoneTitle,
      taskId,
      taskTitle,
      user: req.user._id,
      userName: req.user.name || 'User',
      startTime,
      endTime,
      totalHours: hours,
      isBillable: !!isBillable,
      notes: notes.trim(),
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!project.timesheets) project.timesheets = [];
      project.timesheets.unshift(newTimesheet);

      // Re-sum actual hours
      project.actualHours = project.timesheets
        .filter((ts) => ts.status !== 'Rejected')
        .reduce((acc, ts) => acc + (Number(ts.totalHours) || 0), 0);

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!project.timesheets) project.timesheets = [];
      project.timesheets.unshift(newTimesheet);
      project.actualHours = project.timesheets
        .filter((ts) => ts.status !== 'Rejected')
        .reduce((acc, ts) => acc + (Number(ts.totalHours) || 0), 0);

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.status(201).json({ success: true, message: 'Timesheet logged', project: updatedProject, timesheet: newTimesheet });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to log timesheet', error: err.message });
  }
});

// @route   PATCH /api/projects/:id/timesheets/:timesheetId/status
// @desc    Approve or Reject timesheet (Manager/Super Admin only)
// @access  Private
router.patch('/:id/timesheets/:timesheetId/status', async (req, res) => {
  try {
    const { status, rejectionReason = '' } = req.body;
    let allUsers = [];
    if (fallbackStore.isFallback) allUsers = fallbackStore.users || [];
    else allUsers = await User.find({}).lean();

    let updatedProject;

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!canUserModifyProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'Only Managers / Super Admins can approve timesheets' });
      }

      const ts = (project.timesheets || []).find((t) => t.timesheetId === req.params.timesheetId || t._id?.toString() === req.params.timesheetId);
      if (!ts) return res.status(404).json({ success: false, message: 'Timesheet entry not found' });

      ts.status = status;
      ts.approvedBy = req.user.name;
      ts.approvedAt = new Date().toISOString();
      if (rejectionReason) ts.rejectionReason = rejectionReason;

      project.actualHours = project.timesheets
        .filter((t) => t.status !== 'Rejected')
        .reduce((acc, t) => acc + (Number(t.totalHours) || 0), 0);

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!canUserModifyProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Only Managers / Super Admins can approve timesheets' });
      }

      const ts = project.timesheets.find((t) => t.timesheetId === req.params.timesheetId || t._id?.toString() === req.params.timesheetId);
      if (!ts) return res.status(404).json({ success: false, message: 'Timesheet entry not found' });

      ts.status = status;
      ts.approvedBy = req.user.name;
      ts.approvedAt = new Date();
      if (rejectionReason) ts.rejectionReason = rejectionReason;

      project.actualHours = project.timesheets
        .filter((t) => t.status !== 'Rejected')
        .reduce((acc, t) => acc + (Number(t.totalHours) || 0), 0);

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.json({ success: true, message: `Timesheet marked as ${status}`, project: updatedProject });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update timesheet status', error: err.message });
  }
});

// ==========================================
// 16. Collaboration & Comments
// ==========================================
// @route   POST /api/projects/:id/comments
// @desc    Add collaboration note/comment
// @access  Private
router.post('/:id/comments', async (req, res) => {
  try {
    const { text, isInternal = false } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Comment text is required' });
    }

    let updatedProject;
    const newComment = {
      commentId: `cmt_${Date.now()}`,
      text: text.trim(),
      isInternal: !!isInternal,
      authorId: req.user._id,
      authorName: req.user.name || 'User',
      authorRole: req.user.role || 'Contributor',
      createdAt: new Date().toISOString(),
    };

    if (fallbackStore.isFallback) {
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) return res.status(404).json({ success: false, message: 'Project not found' });
      const project = fallbackStore.projects[pIdx];

      if (!project.comments) project.comments = [];
      project.comments.unshift(newComment);
      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      if (!project.comments) project.comments = [];
      project.comments.unshift(newComment);
      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) io.emit('project_updated', updatedProject);

    return res.status(201).json({ success: true, message: 'Comment added', project: updatedProject, comment: newComment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add comment', error: err.message });
  }
});

// ==========================================
// 17. Delete Project
// ==========================================
// @route   DELETE /api/projects/:id
// @desc    Delete project (Super Admin / Manager / Project Owner)
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    let deleted = false;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      const project = (fallbackStore.projects || []).find((p) => p._id.toString() === req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      if (!canUserModifyProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to delete this project' });
      }

      const initLen = (fallbackStore.projects || []).length;
      fallbackStore.projects = (fallbackStore.projects || []).filter((p) => p._id.toString() !== req.params.id);
      if (fallbackStore.projects.length !== initLen) {
        deleted = true;
        fallbackStore.saveToFile();
      }
    } else {
      allUsers = await User.find({}).lean();
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      if (!canUserModifyProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to delete this project' });
      }

      const resDel = await Project.findByIdAndDelete(req.params.id);
      if (resDel) deleted = true;
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    await logAuditAction({
      entity_type: 'Project',
      entity_id: req.params.id,
      action: 'DELETE',
      operator: req.user,
      delta: `Deleted project ID ${req.params.id}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('project_deleted', { id: req.params.id });
    }

    return res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete project', error: err.message });
  }
});

module.exports = router;
