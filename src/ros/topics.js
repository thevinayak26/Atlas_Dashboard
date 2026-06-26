// -----------------------------------------------------------------------------
// topics.js - THE single source of truth for every topic name / type.
// (DASHBOARD_BUILD_SPEC §6 contract + §4 networking.) Change a name here once and
// every tile that uses it follows. Names marked TBD are the *intended* contract;
// confirm against the rosbag / `ros2 topic list -t` and update here when firmware
// or later features land - no other file should hardcode a topic name.
// -----------------------------------------------------------------------------

// Derive the host from where the page was served, NOT hardcoded localhost - on a
// phone "localhost" is the phone (spec §4). Allow ?host=… override for dev.
const params = new URLSearchParams(window.location.search);
export const HOST =
  params.get('host') || window.location.hostname || 'localhost';

export const ROSBRIDGE_PORT = 9090;
export const VIDEO_PORT = 8080;

export const ROSBRIDGE_URL = `ws://${HOST}:${ROSBRIDGE_PORT}`;
export const cameraUrl = (topic = TOPICS.camera.name) =>
  `http://${HOST}:${VIDEO_PORT}/stream?topic=${topic}`;

// status: 'live'   - expected to be publishing now (Week 3 honest state, §1)
//         'node'   - needs one of our helper nodes (§5) running
//         'later'  - hardware/feature not built yet; tile shows offline placeholder
export const TOPICS = {
  map:        { name: '/map',        type: 'nav_msgs/OccupancyGrid',    status: 'live' },
  scan:       { name: '/scan',       type: 'sensor_msgs/LaserScan',     status: 'live' },
  // EKF (robot_localization) fused output - this is what the dashboard reads for
  // velocity / distance / heading. Raw wheel odom is /odom/wheel; bare /odom may not
  // be published at all. If velocity stays blank on the real robot, run
  // `ros2 topic list -t` and set this to whatever the EKF actually publishes.
  odom:       { name: '/odometry/filtered', type: 'nav_msgs/Odometry',  status: 'live' },
  imu:        { name: '/imu/data',   type: 'sensor_msgs/Imu',           status: 'live' },
  robotPose:  { name: '/robot_pose', type: 'geometry_msgs/PoseStamped', status: 'node' },  // §5a
  sysStats:   { name: '/sys_stats',  type: 'std_msgs/String',           status: 'node' },  // §5b (JSON)
  // Nav2 global plan - drawn as the planned route overlay on the map (pose-free,
  // it's already in the map frame). Only shows when Nav2 is navigating to a goal.
  plan:       { name: '/plan',       type: 'nav_msgs/Path',             status: 'live' },
  // Manual WASD teleop publishes here (the same topic teleop_twist_keyboard uses);
  // the robot's velocity bridge already subscribes to /cmd_vel.
  cmdVel:     { name: '/cmd_vel',    type: 'geometry_msgs/Twist',       status: 'live' },
  // Tap-to-navigate publishes a single Nav2 goal here (map frame). Same topic
  // RViz's "2D Nav Goal" uses; only meaningful while Nav2 is running (otherwise it
  // simply has no subscriber). Gated behind the map's nav-goal toggle.
  goal:       { name: '/goal_pose',  type: 'geometry_msgs/PoseStamped', status: 'live' },
  // TF tree - the map overlay composes map->odom->base_link from these to place the
  // robot + LiDAR scan in the map frame (so the scan shows ON the map without needing
  // a separate /robot_pose publisher). /tf_static is latched.
  tf:         { name: '/tf',         type: 'tf2_msgs/TFMessage',        status: 'live' },
  tfStatic:   { name: '/tf_static',  type: 'tf2_msgs/TFMessage',        status: 'live' },

  // Not yet available - render honest "awaiting/offline" placeholders (§1, §4).
  camera:         { name: '/camera/image_raw',  type: 'sensor_msgs/Image', status: 'later' },
  ultrasonicLow:  { name: '/ultrasonic/front',  type: 'sensor_msgs/Range', status: 'later' },
  ultrasonicCliff:{ name: '/ultrasonic/cliff',  type: 'sensor_msgs/Range', status: 'later' },
};

// rosbridge QoS hints (spec §7/§10): /map is transient-local (latched) and large.
export const SUB_OPTS = {
  map:  { throttle_rate: 250, queue_length: 1 },
  scan: { throttle_rate: 100, queue_length: 1 },
  plan: { throttle_rate: 200, queue_length: 1 },
};

// SLAM-toolbox map-save service (saves <name>.pgm + <name>.yaml on the robot). If
// the stack isn't slam_toolbox, point this at the relevant SaveMap service instead.
export const SAVE_MAP_SERVICE = {
  name: '/slam_toolbox/save_map',
  type: 'slam_toolbox/SaveMap',
};
