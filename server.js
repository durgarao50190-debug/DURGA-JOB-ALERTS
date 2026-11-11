
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();

// Render PORT or local PORT
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Jobs data file
const DATA_FILE = path.join(__dirname, "jobs.json");

// Allowed job statuses
const ALLOWED_STATUSES = [
    "Applications Open",
    "Upcoming",
    "Closed - Exam Ongoing",
    "Closed"
];

// Validate HTTPS URL
function isValidHTTPS(url) {
    try {
        const parsedURL = new URL(url);
        return parsedURL.protocol === "https:";
    } catch {
        return false;
    }
}

// Load jobs
function loadJobs() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(
                fs.readFileSync(DATA_FILE, "utf8")
            );

            return Array.isArray(data) ? data : [];
        }
    } catch (error) {
        console.error("Jobs loading error:", error.message);
    }

    return [];
}

let jobs = loadJobs();

// Save jobs
function saveJobs() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(jobs, null, 2),
        "utf8"
    );
}

// Validate job details
function validateJob(job) {
    if (!job || typeof job !== "object" || Array.isArray(job)) {
        return "Invalid job details";
    }

    if (
        !job.title ||
        !job.department ||
        !job.qualification ||
        !job.notificationUrl ||
        !Array.isArray(job.selectionProcess) ||
        job.selectionProcess.length === 0
    ) {
        return "Required details or selection process are missing";
    }

    if (
        job.interview !== "No" ||
        job.verified !== true
    ) {
        return "Only officially verified no-interview jobs can be added";
    }

    if (!isValidHTTPS(job.notificationUrl)) {
        return "Valid HTTPS notification URL is required";
    }

    if (
        job.applyUrl &&
        !isValidHTTPS(job.applyUrl)
    ) {
        return "Valid HTTPS application URL is required";
    }

    if (
        job.status &&
        !ALLOWED_STATUSES.includes(job.status)
    ) {
        return "Invalid job status";
    }

    return null;
}

// Home page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Backend status
app.get("/api/status", (req, res) => {
    res.json({
        project: "DURGA JOB ALERTS",
        status: "Backend running successfully",
        totalJobs: jobs.length
    });
});

// Get all jobs
app.get("/api/jobs", (req, res) => {
    res.json(jobs);
});

// Get single job
app.get("/api/jobs/:id", (req, res) => {
    const job = jobs.find(
        item => item.id === Number(req.params.id)
    );

    if (!job) {
        return res.status(404).json({
            error: "Job not found"
        });
    }

    res.json(job);
});

// Add new verified job
app.post("/api/jobs", (req, res) => {
    const job = req.body;

    const error = validateJob(job);

    if (error) {
        return res.status(400).json({ error });
    }

    const newJob = {
        id: Date.now(),

        title: job.title,
        department: job.department,
        qualification: job.qualification,

        jobType: job.jobType || "",
        location: job.location || "",

        ageLimit: job.ageLimit || "",
        salary: job.salary || "",
        vacancies: job.vacancies || "",

        lastDate: job.lastDate || "",
        status: job.status || "Upcoming",

        selectionProcess: job.selectionProcess,
        examDetails: job.examDetails || "",

        physicalTest: job.physicalTest || "Not specified",
        skillTest: job.skillTest || "Not specified",
        medicalTest: job.medicalTest || "Not specified",

        interview: "No",
        verified: true,

        notificationUrl: job.notificationUrl,
        applyUrl: job.applyUrl || ""
    };

    jobs.push(newJob);

    try {
        saveJobs();
    } catch (error) {
        jobs.pop();

        console.error("Save error:", error.message);

        return res.status(500).json({
            error: "Unable to save job details"
        });
    }

    res.status(201).json({
        message: "Verified job added successfully",
        job: newJob
    });
});

// Update job
app.put("/api/jobs/:id", (req, res) => {
    const jobId = Number(req.params.id);

    const index = jobs.findIndex(
        job => job.id === jobId
    );

    if (index === -1) {
        return res.status(404).json({
            error: "Job not found"
        });
    }

    const oldJob = jobs[index];

    const updatedJob = {
        ...oldJob,
        ...req.body,

        // Keep original ID and verification status
        id: oldJob.id,
        interview: "No",
        verified: true
    };

    const error = validateJob(updatedJob);

    if (error) {
        return res.status(400).json({ error });
    }

    jobs[index] = updatedJob;

    try {
        saveJobs();
    } catch (error) {
        jobs[index] = oldJob;

        console.error("Update error:", error.message);

        return res.status(500).json({
            error: "Unable to update job details"
        });
    }

    res.json({
        message: "Job updated successfully",
        job: updatedJob
    });
});

// Delete job
app.delete("/api/jobs/:id", (req, res) => {
    const jobId = Number(req.params.id);

    const index = jobs.findIndex(
        job => job.id === jobId
    );

    if (index === -1) {
        return res.status(404).json({
            error: "Job not found"
        });
    }

    const deletedJob = jobs.splice(index, 1)[0];

    try {
        saveJobs();
    } catch (error) {
        jobs.splice(index, 0, deletedJob);

        console.error("Delete error:", error.message);

        return res.status(500).json({
            error: "Unable to delete job"
        });
    }

    res.json({
        message: "Job deleted successfully"
    });
});

// Invalid JSON handler
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400) {
        return res.status(400).json({
            error: "Invalid JSON request"
        });
    }

    console.error(error);

    res.status(500).json({
        error: "Internal server error"
    });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `DURGA JOB ALERTS running on port ${PORT}`
    );
});
