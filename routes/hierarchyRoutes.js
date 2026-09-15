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
      role: userObj.role || 'User',
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
    let targetRootId = null;

    if (!isSuperAdmin) {
      // Non-Super Admin (Managers / Staff) can ONLY view their own subtree
      targetRootId = req.user?._id ? req.user._id.toString() : req.user?.id;
    } else if (managerId) {
      targetRootId = managerId;
    }

    const tree = buildHierarchyTree(allUsers, allTasks, targetRootId);

    return res.json({
      success: true,
      totalEmployees: allUsers.length,
      totalManagers: allUsers.filter((u) => u.role === 'Manager' || u.role === 'Super Admin' || u.role === 'Executive' || u.role === 'Administrator').length,
      totalUsers: allUsers.filter((u) => u.role === 'User' || !u.role || (u.role !== 'Manager' && u.role !== 'Super Admin' && u.role !== 'Executive' && u.role !== 'Administrator')).length,
      hierarchy: tree,
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

module.exports = router;
