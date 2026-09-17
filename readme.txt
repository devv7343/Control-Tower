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
2. PREREQUISITES
------------------------------------------------------------------------
- Node.js (for the frontend)
- Python 3.8+ (for the backend)

------------------------------------------------------------------------
3. SETUP AND INSTALLATION
------------------------------------------------------------------------
Backend Setup:
1. Navigate to the `bend` directory.
2. Create and activate a virtual environment.
3. Install dependencies from requirements (e.g. `pip install fastapi uvicorn sqlalchemy pydantic`).

Frontend Setup:
1. Navigate to the `fend` directory.
2. Run `npm install` to install dependencies.

------------------------------------------------------------------------
4. RUNNING THE APPLICATION
------------------------------------------------------------------------
You can start both the frontend and backend simultaneously using the provided startup script:

    start.bat

Alternatively, you can run them separately:
- Backend: Run `python -m uvicorn main:app --reload --port 8000` from the `bend` directory.
- Frontend: Run `npm run dev` from the `fend` directory.

The application will be accessible at http://localhost:5173

------------------------------------------------------------------------
5. FEATURES
------------------------------------------------------------------------
- Real-time network topology and map view of facilities.
- Intelligent medicine transfer routing and approvals.
- Triage summaries and escalation tracking.
- Interactive forecast charts for medical supplies.
- Automated mock data generation for testing and simulation.

========================================================================
