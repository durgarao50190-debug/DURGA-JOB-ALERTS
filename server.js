
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Jobs data file
const DATA_FILE = path.join(__dirname, "jobs.json");

// Load saved jobs
function loadJobs() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(
                fs.readFileSync(DATA_FILE, "utf8")
            );

            return Array.isArray(data) ? data : [];
        }
    } catch (error) {
        console.error(
            "Jobs database loading error:",
            error.message
        );
    }

    return [];
}

let jobs = loadJobs();

// Save jobs permanently
function saveJobs() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(jobs, null, 2),
        "utf8"
    );
}

// Server status
app.get("/api/status", (req, res) => {
    res.json({
        project: "DURGA JOB ALERTS",
        status: "Backend running successfully"
    });
});

// Get all verified jobs
app.get("/api/jobs", (req, res) => {
    res.json(jobs);
});

// Add a verified no-interview job
app.post("/api/jobs", (req, res) => {
    const job = req.body;

    if (
        !job.title ||
        !job.department ||
        !job.qualification ||
        !job.notificationUrl ||
        !Array.isArray(job.selectionProcess) ||
        job.selectionProcess.length === 0
    ) {
        return res.status(400).json({
            error: "Required details or selection process are missing"
        });
    }

    if (job.interview !== "No" || job.verified !== true) {
        return res.status(400).json({
            error: "Only officially verified no-interview jobs can be added"
        });
    }

    // Validate official notification URL
    try {
        const notificationURL = new URL(job.notificationUrl);

        if (notificationURL.protocol !== "https:") {
            throw new Error("Invalid URL");
        }
    } catch (error) {
        return res.status(400).json({
            error: "Valid HTTPS notification URL is required"
        });
    }

    const allowedStatuses = [
        "Applications Open",
        "Upcoming",
        "Closed - Exam Ongoing",
        "Closed"
    ];

    if (
        job.status &&
        !allowedStatuses.includes(job.status)
    ) {
        return res.status(400).json({
            error: "Invalid job status"
        });
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

        // Application dates and status
        lastDate: job.lastDate || "",
        status: job.status || "Upcoming",

        // Selection and examination details
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

        return res.status(500).json({
            error: "Unable to save job details"
        });
    }

    res.status(201).json({
        message: "Verified job added successfully",
        job: newJob
    });
});

// Update an existing job using its ID
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

    const updatedData = req.body;
    const oldJob = jobs[index];

    const allowedStatuses = [
        "Applications Open",
        "Upcoming",
        "Closed - Exam Ongoing",
        "Closed"
    ];

    if (
        updatedData.status &&
        !allowedStatuses.includes(updatedData.status)
    ) {
        return res.status(400).json({
            error: "Invalid job status"
        });
    }

    const updatedJob = {
        ...oldJob,
        ...updatedData,
        id: oldJob.id,
        interview: "No",
        verified: true
    };

    // Validate notification URL if changed
    try {
        const notificationURL = new URL(
            updatedJob.notificationUrl
        );

        if (notificationURL.protocol !== "https:") {
            throw new Error("Invalid URL");
        }
    } catch (error) {
        return res.status(400).json({
            error: "Valid HTTPS notification URL is required"
        });
    }

    if (
        !updatedJob.title ||
        !updatedJob.department ||
        !updatedJob.qualification ||
        !Array.isArray(updatedJob.selectionProcess) ||
        updatedJob.selectionProcess.length === 0
    ) {
        return res.status(400).json({
            error: "Required job details are missing"
        });
    }

    jobs[index] = updatedJob;

    try {
        saveJobs();
    } catch (error) {
        jobs[index] = oldJob;

        return res.status(500).json({
            error: "Unable to update job details"
        });
    }

    res.json({
        message: "Job updated successfully",
        job: updatedJob
    });
});

// Delete a job using its ID
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

        return res.status(500).json({
            error: "Unable to delete job"
        });
    }

    res.json({
        message: "Job deleted successfully"
    });
});

// Start server
app.listen(PORT, () => {
    console.log(
        `DURGA JOB ALERTS running at http://localhost:${PORT}`
    );
});
