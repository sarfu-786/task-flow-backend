const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Task = require('../models/Task');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

/**
 * Builds a dynamic organizational hierarchy tree from an array of users and tasks.
 * Calculates teamCount, taskCount, tasksBreakdown, and the complete reportingChain.
 */
const buildHierarchyTree = (users, tasks, targetRootUserId = null) => {
  // Map users by ID and by lowercase name/username for robust lookup
  const userMap = new Map();
  const idMap = new Map();

  users.forEach((u) => {
    const userIdStr = u._id ? u._id.toString() : '';
    idMap.set(userIdStr, u);
    if (u.name) userMap.set(u.name.toLowerCase().trim(), u);
    if (u.username) userMap.set(u.username.toLowerCase().trim(), u);
  });

  // Calculate task statistics per user
  const getUserTasks = (userObj) => {
    if (!userObj) return { tasks: [], stats: { total: 0, completed: 0, inProgress: 0, todo: 0 } };
    const uName = (userObj.name || '').toLowerCase().trim();
    const uUsername = (userObj.username || '').toLowerCase().trim();
    const uId = userObj._id ? userObj._id.toString() : '';

    const matchedTasks = tasks.filter((t) => {
      if (!t) return false;
      const assigned = (t.assignedTo || '').toLowerCase().trim();
      const taskUserId = t.user ? (t.user._id ? t.user._id.toString() : t.user.toString()) : '';
      return assigned === uName || assigned === uUsername || (taskUserId && taskUserId === uId);
    });

    const completed = matchedTasks.filter((t) => t.status === 'Completed').length;
    const inProgress = matchedTasks.filter((t) => t.status === 'In Progress').length;
    const todo = matchedTasks.filter((t) => t.status === 'To Do' || !t.status).length;

    return {
      tasks: matchedTasks.map((t) => ({
        _id: t._id,
        taskType: t.taskType,
        description: t.description,
        expectedDate: t.expectedDate,
        status: t.status || 'To Do',
        remark: t.remark || '',
        completionRemark: t.completionRemark || '',
      })),
      stats: {
        total: matchedTasks.length,
        completed,
        inProgress,
        todo,
      },
    };
  };

  // Helper to compute reporting chain up to root
  const computeReportingChain = (userObj) => {
    const chain = [];
    let current = userObj;
    const visited = new Set();

    while (current && !visited.has(current._id.toString())) {
      visited.add(current._id.toString());
      chain.push({
        _id: current._id,
        name: current.name,
        role: current.role,
        roles: Array.isArray(current.roles) && current.roles.length > 0 ? current.roles : [current.role || 'User'],
        department: current.department,
        email: current.email,
        avatar: current.avatar || '',
      });

      if (!current.reportsTo) break;
      const repId = current.reportsTo.toString();
      const nextParent = idMap.get(repId);
      if (!nextParent || nextParent._id.toString() === current._id.toString()) break;
      current = nextParent;
    }

    return chain;
  };

  // Build parent -> children relationship map
  const childrenMap = new Map();
  users.forEach((u) => {
    let repId = 'ROOT';
    const rIdStr = u.reportsTo ? (u.reportsTo._id ? u.reportsTo._id.toString() : u.reportsTo.toString()) : '';
    const rawRName = (u.reportsToName || '').toLowerCase().trim();
    const cleanRName = rawRName.replace(/\s*\([^)]*\)/g, '').trim();

    if (rIdStr && (idMap.has(rIdStr) || targetRootUserId)) {
      repId = rIdStr;
    } else if (cleanRName && userMap.has(cleanRName)) {
      repId = userMap.get(cleanRName)._id.toString();
    } else if (rawRName && userMap.has(rawRName)) {
      repId = userMap.get(rawRName)._id.toString();
    } else if (u.createdBy && idMap.has(u.createdBy.toString())) {
      repId = u.createdBy.toString();
    }

    if (!childrenMap.has(repId)) {
      childrenMap.set(repId, []);
    }
    childrenMap.get(repId).push(u);
  });

  // Recursive node tree builder
  const buildNode = (userObj, depth = 1, visitedSet = new Set()) => {
    const userTaskInfo = getUserTasks(userObj);
    const userIdStr = userObj._id ? userObj._id.toString() : '';
    const rawChildren = childrenMap.get(userIdStr) || [];
    const userRoles = Array.isArray(userObj.roles) && userObj.roles.length > 0
      ? userObj.roles
      : [userObj.role || 'User'];

    visitedSet.add(userIdStr);

    // Recursively build child nodes, preventing cycles
    const children = rawChildren
      .filter((child) => child && child._id && !visitedSet.has(child._id.toString()))
      .map((child) => buildNode(child, depth + 1, visitedSet));

    // Calculate total team size (direct + indirect subordinates)
    const teamCount = children.reduce((acc, child) => acc + 1 + (child.teamCount || 0), 0);

    return {
      _id: userObj._id,
      name: userObj.name,
      email: userObj.email,
      username: userObj.username,
      role: userObj.role || userRoles[0] || 'User',
      roles: userRoles,
      department: userObj.department || 'Operations',
      avatar: userObj.avatar || '',
      status: userObj.status || 'Approved',
      reportsTo: userObj.reportsTo || null,
      reportsToName: userObj.reportsToName || '',
      depth,
      teamCount,
      taskCount: userTaskInfo.stats.total,
      tasksBreakdown: userTaskInfo.stats,
      tasks: userTaskInfo.tasks,
      reportingChain: computeReportingChain(userObj),
      children,
    };
  };

  // Find root user(s)
  let rootUser = null;

  if (targetRootUserId) {
    rootUser = idMap.get(targetRootUserId.toString());
  }

  if (!rootUser) {
    // 1. Look for Super Admin with no reportsTo
    rootUser = users.find((u) => u.role === 'Super Admin' && !u.reportsTo);
    // 2. Look for any Super Admin
    if (!rootUser) {
      rootUser = users.find((u) => u.role === 'Super Admin');
    }
    // 3. Look for any user with no reportsTo
    if (!rootUser) {
      rootUser = users.find((u) => !u.reportsTo);
    }
    // 4. Fallback to first user
    if (!rootUser && users.length > 0) {
      rootUser = users[0];
    }
  }

  if (!rootUser) {
    return null;
  }

  const visitedNodes = new Set();
  const rootNode = buildNode(rootUser, 1, visitedNodes);

  // Helper to collect all node IDs present in the tree
  const getAllTreeIds = (node) => {
    const ids = new Set();
    if (!node || !node._id) return ids;
    ids.add(node._id.toString());
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => {
        getAllTreeIds(child).forEach((id) => ids.add(id));
      });
    }
    return ids;
  };

  // If this is the full organization tree (no specific targetRootUserId),
  // attach any unparented subtree roots under main root so entire branches stay intact
  if (!targetRootUserId) {
    const allIncludedIds = getAllTreeIds(rootNode);
    const unattachedUsers = users.filter((u) => {
      const uId = u._id ? u._id.toString() : '';
      return uId && !allIncludedIds.has(uId);
    });

    const unattachedIds = new Set(unattachedUsers.map((u) => (u._id ? u._id.toString() : '')));
    const subtreeRoots = unattachedUsers.filter((u) => {
      let parentId = null;
      const rIdStr = u.reportsTo ? (u.reportsTo._id ? u.reportsTo._id.toString() : u.reportsTo.toString()) : '';
      const rawRName = (u.reportsToName || '').toLowerCase().trim();
      const cleanRName = rawRName.replace(/\s*\([^)]*\)/g, '').trim();

      if (rIdStr && idMap.has(rIdStr)) {
        parentId = rIdStr;
      } else if (cleanRName && userMap.has(cleanRName)) {
        parentId = userMap.get(cleanRName)._id.toString();
      } else if (rawRName && userMap.has(rawRName)) {
        parentId = userMap.get(rawRName)._id.toString();
      } else if (u.createdBy && idMap.has(u.createdBy.toString())) {
        parentId = u.createdBy.toString();
      }

      return !parentId || !unattachedIds.has(parentId);
    });

    subtreeRoots.forEach((subRoot) => {
      const childNode = buildNode(subRoot, 2, visitedNodes);
      rootNode.children.push(childNode);
    });

    // Recalculate root team count
    rootNode.teamCount = rootNode.children.reduce((acc, child) => acc + 1 + (child.teamCount || 0), 0);
  }

  return rootNode;
};

// @route   GET /api/hierarchy
// @desc    Get dynamic organizational hierarchy tree from database
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { managerId } = req.query;
    let allUsers = [];
    let allTasks = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users.filter((u) => u.status !== 'Rejected' && u.status !== 'Pending');
      allTasks = fallbackStore.tasks || [];
    } else {
      allUsers = await User.find({ status: { $nin: ['Rejected', 'Pending'] } })
        .select('-password')
        .sort({ createdAt: 1 })
        .lean();
      allTasks = await Task.find({}).lean();
    }

    const isSuperAdmin = req.user && req.user.role === 'Super Admin';
    const currentUserIdStr = req.user?._id ? req.user._id.toString() : (req.user?.id ? req.user.id.toString() : '');
    let targetRootId = null;

    if (!isSuperAdmin) {
      // Non-Super Admin (Managers / Staff) can view their subtree as root
      targetRootId = currentUserIdStr;
    } else if (managerId) {
      targetRootId = managerId;
    }

    const tree = buildHierarchyTree(allUsers, allTasks, targetRootId);

    // Compute upward reporting chain from current logged-in user up to Super Admin
    const currentUserObj = allUsers.find(
      (u) => (u._id && u._id.toString() === currentUserIdStr) || (u.email && u.email.toLowerCase() === (req.user?.email || '').toLowerCase())
    );

    let myReportingChain = [];
    let mySupervisor = null;
    let myPeers = [];

    if (currentUserObj) {
      // 1. Upward Reporting Chain
      let curr = currentUserObj;
      const visited = new Set();
      while (curr && !visited.has(curr._id ? curr._id.toString() : '')) {
        const cId = curr._id ? curr._id.toString() : '';
        visited.add(cId);
        myReportingChain.push({
          _id: curr._id,
          name: curr.name,
          role: curr.role,
          roles: Array.isArray(curr.roles) && curr.roles.length > 0 ? curr.roles : [curr.role || 'User'],
          department: curr.department || 'Operations',
          email: curr.email,
          avatar: curr.avatar || '',
        });

        if (!curr.reportsTo) break;
        const repId = (curr.reportsTo._id ? curr.reportsTo._id.toString() : curr.reportsTo.toString()).trim();
        const repName = (curr.reportsToName || '').toLowerCase().trim();
        const nextParent = allUsers.find(
          (u) =>
            (u._id && u._id.toString() === repId) ||
            (repName && u.name && u.name.toLowerCase().trim() === repName)
        );
        if (!nextParent || (nextParent._id && nextParent._id.toString() === cId)) break;
        curr = nextParent;
      }

      // 2. Direct Supervisor (the immediate parent)
      if (myReportingChain.length > 1) {
        mySupervisor = myReportingChain[1];
      }

      // 3. Peers (Colleagues who share the same direct supervisor)
      if (mySupervisor) {
        const supIdStr = mySupervisor._id ? mySupervisor._id.toString() : '';
        const supName = (mySupervisor.name || '').toLowerCase().trim();

        myPeers = allUsers
          .filter((u) => {
            const uId = u._id ? u._id.toString() : '';
            if (uId === currentUserIdStr) return false;
            const rId = u.reportsTo ? (u.reportsTo._id ? u.reportsTo._id.toString() : u.reportsTo.toString()) : '';
            const rName = (u.reportsToName || '').toLowerCase().trim();
            return (supIdStr && rId === supIdStr) || (supName && rName === supName);
          })
          .map((u) => {
            const uTasks = allTasks.filter(
              (t) =>
                t &&
                ((t.assignedTo || '').toLowerCase().trim() === (u.name || '').toLowerCase().trim() ||
                  (t.user && (t.user._id ? t.user._id.toString() : t.user.toString()) === (u._id ? u._id.toString() : '')))
            );
            return {
              _id: u._id,
              name: u.name,
              role: u.role,
              department: u.department || 'Operations',
              email: u.email,
              avatar: u.avatar || '',
              taskCount: uTasks.length,
              completedTasks: uTasks.filter((t) => t.status === 'Completed').length,
            };
          });
      }
    }

    // Department Stats
    const departmentMap = new Map();
    allUsers.forEach((u) => {
      const dept = u.department || 'Operations';
      departmentMap.set(dept, (departmentMap.get(dept) || 0) + 1);
    });
    const departmentStats = Array.from(departmentMap.entries()).map(([name, count]) => ({ name, count }));

    // Overall Tasks Stats
    const completedTasksCount = allTasks.filter((t) => t && t.status === 'Completed').length;
    const inProgressTasksCount = allTasks.filter((t) => t && t.status === 'In Progress').length;
    const todoTasksCount = allTasks.filter((t) => t && (t.status === 'To Do' || !t.status)).length;

    return res.json({
      success: true,
      totalEmployees: allUsers.length,
      totalManagers: allUsers.filter((u) => u.role === 'Manager' || u.role === 'Super Admin' || u.role === 'Executive' || u.role === 'Administrator').length,
      totalUsers: allUsers.filter((u) => u.role === 'User' || !u.role || (u.role !== 'Manager' && u.role !== 'Super Admin' && u.role !== 'Executive' && u.role !== 'Administrator')).length,
      totalTasks: allTasks.length,
      completedTasks: completedTasksCount,
      inProgressTasks: inProgressTasksCount,
      todoTasks: todoTasksCount,
      departmentStats,
      hierarchy: tree,
      myReportingChain,
      mySupervisor,
      myPeers,
      currentUser: currentUserObj
        ? {
            _id: currentUserObj._id,
            name: currentUserObj.name,
            email: currentUserObj.email,
            role: currentUserObj.role,
            department: currentUserObj.department || 'Operations',
            avatar: currentUserObj.avatar || '',
          }
        : null,
    });
  } catch (error) {
    console.error('Fetch hierarchy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to build organizational hierarchy',
      error: error.message,
    });
  }
});

// @route   GET /api/hierarchy/chain/:userId
// @desc    Get complete reporting chain for a specific user
// @access  Private
router.get('/chain/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users.filter((u) => u.status !== 'Rejected' && u.status !== 'Pending');
    } else {
      allUsers = await User.find({ status: { $nin: ['Rejected', 'Pending'] } })
        .select('-password')
        .lean();
    }

    const targetUser = allUsers.find((u) => u._id && u._id.toString() === userId.toString());
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found in hierarchy' });
    }

    const chain = [];
    let curr = targetUser;
    const visited = new Set();

    while (curr && !visited.has(curr._id.toString())) {
      visited.add(curr._id.toString());
      chain.push({
        _id: curr._id,
        name: curr.name,
        role: curr.role,
        department: curr.department || 'Operations',
        email: curr.email,
        avatar: curr.avatar || '',
      });

      if (!curr.reportsTo) break;
      const repId = (curr.reportsTo._id ? curr.reportsTo._id.toString() : curr.reportsTo.toString()).trim();
      const repName = (curr.reportsToName || '').toLowerCase().trim();
      const nextParent = allUsers.find(
        (u) => (u._id && u._id.toString() === repId) || (repName && u.name && u.name.toLowerCase().trim() === repName)
      );
      if (!nextParent || (nextParent._id && nextParent._id.toString() === curr._id.toString())) break;
      curr = nextParent;
    }

    return res.json({ success: true, chain });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/hierarchy/subordinates/:userId
// @desc    Get all direct & indirect subordinates for a user
// @access  Private
router.get('/subordinates/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    let allUsers = [];
    let allTasks = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users.filter((u) => u.status !== 'Rejected' && u.status !== 'Pending');
      allTasks = fallbackStore.tasks || [];
    } else {
      allUsers = await User.find({ status: { $nin: ['Rejected', 'Pending'] } })
        .select('-password')
        .lean();
      allTasks = await Task.find({}).lean();
    }

    const tree = buildHierarchyTree(allUsers, allTasks, userId);
    return res.json({ success: true, tree });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
