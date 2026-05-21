const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'src', 'index.js');
let contents = fs.readFileSync(target, 'utf8');
contents = contents.replace(
  "const paymentsRoutes = require('./routes/payments');\n\nconst app = express();\n",
  "const paymentsRoutes = require('./routes/payments');\nconst demoRoutes = require('./routes/demo');\n\nconst app = express();\n"
);
contents = contents.replace(
  "app.use('/api/auth', authRoutes);\napp.use('/api/documents', documentsRoutes);\napp.use('/api/dashboard', dashboardRoutes);\napp.use('/api/scan', scanRoutes);\napp.use('/api/payments', paymentsRoutes);\n",
  "app.use('/api/auth', authRoutes);\napp.use('/api/documents', documentsRoutes);\napp.use('/api/dashboard', dashboardRoutes);\napp.use('/api/scan', scanRoutes);\napp.use('/api/payments', paymentsRoutes);\napp.use('/api/demo', demoRoutes);\n"
);
fs.writeFileSync(target, contents, 'utf8');
console.log('Patched index.js');
