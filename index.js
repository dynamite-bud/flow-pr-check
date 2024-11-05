const express = require("express");
const axios = require("axios");
const {OpenAI} = require("openai");
const app = express();
const PORT = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("Starting server on port", PORT);

app.use(express.json());

// GitHub Webhook endpoint
app.post("/github-webhook", async (req, res) => {
    const event = req.headers["x-github-event"];

    if (event === "pull_request" && req.body.action === "opened") {
        
        const { number,repository } = req.body;
        console.log("Processing PR #" + number);
        console.log("Repository:", repository.full_name);
        
        const owner = repository.owner.login;
        const repo = repository.name;
        
        try {
            // Step 2: Retrieve PR File Changes
            const fileChanges = await getPullRequestFiles(owner, repo, number);

            console.log(">>> File Changes",fileChanges);
            
            // Step 3: Pass Changes to OpenAI for Review
            const reviewText = await analyzeCodeChanges(fileChanges);
            
            // Step 4: Post Review as a Comment on the PR
            await postPRReview(owner, repo, number, reviewText);

            console.log("Review posted successfully on PR #" + number);
            res.status(200).send("Review posted");
        } catch (error) {
            console.error("Error processing PR:", error);
            res.status(500).send("Internal Server Error");
        }
    } else {
        console.log("Ignoring event:", event);
        res.sendStatus(200);
    }
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

async function getPullRequestFiles(owner, repo, pull_number) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/files`;

    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
        },
    });

    return response.data;
}

async function analyzeCodeChanges(fileChanges) {
    const changesText = fileChanges
        .map(file => `File: ${file.filename}\nDiff:\n${file.patch}`)
        .join("\n\n");

    const response = await openai.chat.completions.create({
        model:"gpt-4o",
        messages: [
            {role: "system", content: "You are a code reviewer reviewing a PR with some code changes."},
            {role: "user", content: changesText},
            {role: "system", content: "Write a markdown summary for the PR."},
        ],
    })

    return response.choices[0].message.content;
}

async function postPRReview(owner, repo, pull_number, reviewText) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${pull_number}/comments`;

    await axios.post(
        url,
        { body: reviewText },
        {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json",
            },
        }
    );
}
