const {GoogleGenAI} =require("@google/genai")
const {z} = require("zod")
const {zodToJsonSchema}=require("zod-to-json-schema")
const puppeteer =require('puppeteer') // converting html to pdf

const ai=new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENAI_API_KEY
})

// allow overriding model via env var for flexibility
const AI_MODEL = process.env.GENAI_MODEL || 'gemini-3-flash-preview'

// Helper: retry wrapper with exponential backoff for transient errors
async function callWithRetry(fn, { retries = 3, initialDelay = 1000 } = {}) {
  let attempt = 0
  let delay = initialDelay

  while (attempt < retries) {
    try {
      return await fn()
    } catch (err) {
      attempt++

      // inspect error for transient / rate limit / service unavailable signals
      const statusCode = err?.error?.code || err?.statusCode || err?.status || null
      const isTransient = statusCode === 503 || /high demand|UNAVAILABLE|rate limit|429/i.test(String(err?.message || '') )

      if (!isTransient || attempt >= retries) {
        throw err
      }

      console.warn(`AI call failed (attempt ${attempt}) — retrying after ${delay}ms`, String(err?.message || err))
      await new Promise(r => setTimeout(r, delay))
      delay *= 2
    }
  }
}

const interviewReportSchema = z.object({
    matchScore:z.number().describe("A score between 0 and 100 indication how well the candidate's profile matchs for the job description"),
  technicalQuestions: z.array(
    z.object({
      question: z.string().describe("The technical question can be asked in the interview"),
      intention: z.string().describe("The intention of interviewer behind asking this question"),
      answer: z.string().describe("How to answer this question, what points to cover, what approach"),
    })
  ).describe("Technical questions that can be asked in the interview along with their intention"),

  behavioralQuestions: z.array(
    z.object({
      question: z.string().describe("The technical question can be asked in the interview"),
      intention: z.string().describe("The intention of interviewer behind asking this question"),
      answer: z.string().describe("How to answer this question, what points to cover, what approach"),
    })
  ).describe("Behavioral questions that can be asked in the interview along with their intention"),

  skillGaps: z.array(
    z.object({
      skill: z.string().describe("The skill which the candidate is lacking"),
      severity: z.enum(["low", "medium", "high"]).describe("The severity of this skill gap"),
    })
  ).describe("List of skill gaps in the candidate's profile along with their severity"),

  preparationPlan: z.array(
    z.object({
      day: z.number().describe("The day number in the preparation plan, starting from 1"),
      focus: z.string().describe("The main focus of this day in the preparation plan, e.g. data structures"),
      tasks: z.array(z.string()).describe("List of tasks to be done on this day"),
    })
  ).describe("A day-wise preparation plan for the candidate to follow")
});
/** for the prompt */
async function generateInterviewReport({ resume, selfDescription, jobDescription }) {
  
  const prompt = `
    You are an expert interviewer.

    Return ONLY valid JSON.

    STRICT FORMAT:

    {
    "matchScore": number,
    "technicalQuestions": [
        {
        "question": "...",
        "intention": "...",
        "answer": "..."
        }
    ],
    "behavioralQuestions": [
        {
        "question": "...",
        "intention": "...",
        "answer": "..."
        }
    ],
    "skillGaps": [
        {
        "skill": "...",
        "severity": "low | medium | high"
        }
    ],
    "preparationPlan": [
        {
        "day": number,
        "focus": "...",
        "tasks": ["...", "..."]
        }
    ]
    }

    Rules:
    - Do NOT skip any field
    - Do NOT return string instead of array
    - Generate at least:
    - 5 technical questions
    - 3 behavioral
    - 3 skill gaps
    - 5 days plan

    Resume: ${resume}
    Self Description: ${selfDescription}
    Job Description: ${jobDescription}
    `;
  const response = await callWithRetry(() => ai.models.generateContent({
    model: AI_MODEL,
    contents: prompt,
    // ❌ REMOVE schema for now (important for debugging)
  }))

  // ✅ STEP 2 — get correct text
  const rawText =
    response.text ||
    response?.candidates?.[0]?.content?.parts?.[0]?.text;

  console.log("RAW TEXT:", rawText);

  if (!rawText) {
    throw new Error("No response from Gemini");
  }

  // ✅ STEP 3 — clean markdown if present
  const cleaned = rawText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  // ✅ STEP 4 — parse safely
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("❌ JSON ERROR:", cleaned);
    throw new Error("Invalid JSON from AI");
  }

  console.log("PARSED:", parsed);
  // Basic sanitization to ensure required fields exist and prevent DB validation errors
  const sanitize = (obj) => {
    const out = {}
    out.matchScore = typeof obj.matchScore === 'number' ? obj.matchScore : Number(obj.matchScore) || 0

    out.technicalQuestions = Array.isArray(obj.technicalQuestions) ? obj.technicalQuestions.map(q => ({
      question: q?.question || "",
      intention: q?.intention || "",
      answer: q?.answer || ""
    })) : []

    out.behavioralQuestions = Array.isArray(obj.behavioralQuestions) ? obj.behavioralQuestions.map(q => ({
      question: q?.question || "",
      intention: q?.intention || "",
      answer: q?.answer || ""
    })) : []

    out.skillGaps = Array.isArray(obj.skillGaps) ? obj.skillGaps.map(s => ({
      skill: s?.skill || "",
      severity: ["low","medium","high"].includes(s?.severity) ? s.severity : "low"
    })) : []

    out.preparationPlan = Array.isArray(obj.preparationPlan) ? obj.preparationPlan.map(p => ({
      day: typeof p?.day === 'number' ? p.day : Number(p?.day) || 1,
      focus: p?.focus || "",
      tasks: Array.isArray(p?.tasks) ? p.tasks.map(t => String(t || "")) : []
    })) : []

    return out
  }

  const sanitized = sanitize(parsed)

  // Log if sanitization changed anything (helps debugging AI output)
  if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
    console.warn('AI output sanitized to satisfy schema requirements')
    console.log('SANITIZED:', sanitized)
  }

  return sanitized;
}

// html to pdf
async function generatePdfFromHtml(htmlContent) {

    if (!htmlContent) {
        throw new Error("HTML content missing")
    }

    const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: "new",
    timeout: 60000,
    // allow overriding executable path in environments where Chrome is preinstalled
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined,
    })

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" })

    const pdfBuffer = await page.pdf({
        format: "A4", margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm"
        }
    })

    await browser.close()

    return pdfBuffer
}

// creating html format data
async function generateResumePdf({resume,selfDescription,jobDescription}){
  
  const resumePdfSchema = z.object({
        html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
    })

    const prompt = `Generate resume for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}

                        the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
                        The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
                        The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
                        you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
                        The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
                        The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.
                    `

    const response = await callWithRetry(() => ai.models.generateContent({
      model: AI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: zodToJsonSchema(resumePdfSchema),
      }
    }))


    const cleaned = response.text
    .replace(/```json/g,"")
    .replace(/```/g,"")
    .trim()

    const jsonContent = JSON.parse(cleaned)

    if(!jsonContent.html){
      throw new Error("HTML missing from AI response")
    }


    const pdfBuffer = await generatePdfFromHtml(jsonContent.html)

    return pdfBuffer

}


module.exports={generateInterviewReport,generateResumePdf,generatePdfFromHtml}