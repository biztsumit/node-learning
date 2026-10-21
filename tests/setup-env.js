// Loaded before every test file (see the "test" script in package.json).
// Points the app at a SEPARATE test database and makes it quiet and predictable.
// dotenv never overrides variables that are already set, so these win over .env.

process.env.NODE_ENV = "test";
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "ecommerce_test";
process.env.LOG_LEVEL = "silent";

// Tests make many requests from one IP, so the rate limits must not get in the way
process.env.API_RATE_LIMIT = "100000";
process.env.LOGIN_RATE_LIMIT = "100000";
process.env.SIGNUP_RATE_LIMIT = "100000";
process.env.TRUST_PROXY = "0";
process.env.CORS_ORIGINS = "http://localhost:5173";

// Fake Razorpay keys. The payment tests intercept calls to Razorpay, so nothing leaves this machine.
process.env.RAZORPAY_KEY_ID = "rzp_test_AUTOMATEDTESTS";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

// Tests NEVER send real email, whatever .env says: "log" mode keeps them in memory
process.env.EMAIL_TRANSPORT = "log";
process.env.BREVO_API_KEY = "";
process.env.EMAIL_REDIRECT_TO = "";

// Fake Cloudinary account. The upload tests intercept calls to Cloudinary, too.
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "111111111111111";
process.env.CLOUDINARY_API_SECRET = "test_cloudinary_secret";

// The tests delete everything in their database before each test. Never let that be the real one.
if (!process.env.DB_NAME.endsWith("_test")) {
  throw new Error(`Refusing to run tests against "${process.env.DB_NAME}": the database name must end with "_test"`);
}
