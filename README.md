# Sun PowerTools ERP - Full-Stack Application

Enterprise Resource Planning (ERP) web application for Sun PowerTools, built with a Node.js/Express backend, EJS server-rendered frontend, Bootstrap 5 UI, and MySQL database.

---

## 📁 Project Architecture & Directory Layout

```text
tools/
├── assets/                         # Static Frontend Assets
│   ├── css/                        # Custom stylesheets & Bootstrap CSS
│   ├── images/                     # Logos, avatars, PNG/SVG UI graphics, favicons
│   ├── js/                         # Client-side scripts (main.js, Bootstrap bundle)
│   └── vendors/                    # Third-party vendor assets (Bootstrap Icons, webfonts)
│
├── backend/                        # Backend Application (Node.js & Express)
│   ├── server.js                   # Main application entrypoint
│   ├── config/                     # Database & environment configurations
│   │   └── db.js                   # MySQL connection pool configuration
│   ├── controllers/                # Request handlers and business logic
│   │   ├── authController.js
│   │   ├── brandController.js
│   │   ├── categoryController.js
│   │   ├── customerController.js
│   │   ├── dashboardController.js
│   │   ├── productController.js
│   │   ├── productTypeController.js
│   │   ├── profileController.js
│   │   ├── salesNoteController.js
│   │   ├── settingsController.js
│   │   ├── unitController.js
│   │   └── userController.js
│   ├── middleware/                 # Express middleware (Auth, View Helpers, Uploads)
│   │   ├── auth.js
│   │   ├── upload.js
│   │   └── viewHelpers.js
│   ├── routes/                     # Modular Express route definitions
│   ├── utils/                      # Business logic helpers (Financial & Inventory calculations)
│   ├── views/                      # Frontend View Templates (EJS)
│   │   ├── includes/               # Reusable view partials (header, footer, sidebar)
│   │   └── *.ejs                   # UI Page templates (Masters, Sales Notes, Customers, etc.)
│   ├── test_integration.js         # Automated endpoint & authentication test suite
│   └── test_full_workflow.js       # End-to-end transaction & business logic tests
│
├── database/                       # Database Schemas & Migrations
│   └── powertools_db.sql           # Complete MySQL database schema and seed data
│
├── uploads/                        # User-Uploaded Media & Assets
│   ├── avatars/                    # User profile photos
│   └── products/                   # Product catalog images
│
├── .env                            # Environment variables (Database, Port, Secrets)
├── .env.example                    # Template for environment variables
├── package.json                    # Project dependencies and npm scripts
└── README.md                       # Project documentation
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18+ (Tested on v24.18.1)
- **MySQL / MariaDB**: (Running locally, e.g. via XAMPP on port 3306)

### 2. Database Setup
1. Start MySQL in XAMPP Control Panel.
2. Import `database/powertools_db.sql` into MySQL:
   ```sql
   CREATE DATABASE powertools_db;
   USE powertools_db;
   SOURCE database/powertools_db.sql;
   ```

### 3. Environment Configuration
Verify your `.env` file matches your local environment:
```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=sun_powertools_session_secret_key_8923487329482

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=powertools_db
```

### 4. Running the Application
- **Start Server**:
  ```bash
  npm start
  ```
- **Development Mode (Auto-Reload)**:
  ```bash
  npm run dev
  ```
- **Run Integration Tests**:
  ```bash
  npm test
  ```
- **Run Full Workflow & Transaction Tests**:
  ```bash
  npm run test:workflow
  ```

---

## 🔑 Default Credentials
- **URL**: `http://localhost:3000/login.php`
- **Username**: `Admin123`
- **Password**: `Admin123`
