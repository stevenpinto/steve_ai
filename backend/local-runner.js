require('dotenv').config();
process.env.USE_LOCAL_RUNNER = 'true';

// For local development, use the Express app directly (not the Lambda handler)
// This preserves streaming/SSE support which serverless-http would buffer
const { app } = require('./src/index.js');

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Local dev server running at http://localhost:${PORT}`);
});
