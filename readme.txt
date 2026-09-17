========================================================================
CONTROL TOWER
========================================================================

Control Tower is an advanced, full-stack application designed to manage, visualize, and optimize medical supply chains and facility networks. It features a modern React frontend and a robust FastAPI backend.

------------------------------------------------------------------------
1. PROJECT STRUCTURE
------------------------------------------------------------------------
- /bend (Backend)
  Built with FastAPI, Python, and SQLAlchemy. It handles API requests, database management, triage simulation, escalation processes, and machine learning mock data generation.

- /fend (Frontend)
  Built with React and Vite. It provides a highly interactive user interface including network topologies, map views, triage summaries, forecast charts, and transfer management panels.

------------------------------------------------------------------------
2. HOW TO RUN
------------------------------------------------------------------------
Running Control Tower is incredibly simple. You do not need to install Python, Node.js, or download any dependencies!

Simply double-click the `ControlTower.exe` file.
- The backend server will start automatically in a background console.
- Your default web browser will open straight to the application (http://127.0.0.1:8000).
- To stop the application, just close the black console window.

------------------------------------------------------------------------
3. FOR DEVELOPERS (Building from Source)
------------------------------------------------------------------------
If you wish to modify the code and build your own executable:
1. Navigate to `/fend` and run `npm install` and `npm run build`.
2. Navigate to `/bend` and set up a Python virtual environment.
3. Install requirements (`pip install -r requirements.txt`).
4. Run `pyinstaller ControlTower.spec` to generate the new executable.

------------------------------------------------------------------------
4. FEATURES
------------------------------------------------------------------------
- Real-time network topology and map view of facilities.
- Intelligent medicine transfer routing and approvals.
- Triage summaries and escalation tracking.
- Interactive forecast charts for medical supplies.
- Automated mock data generation for testing and simulation.

========================================================================
