const {GoogleGenAI} =require("@google/genai")
const {z} = require("zod")
const {zodToJsonSchema}=require("zod-to-json-schema")
const puppeteer =require('puppeteer') // converting html to pdf

const ai=new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY
})

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
  ).describe("A day-wise preparation plan for the candidate to follow"),
  title: z.string().describe("The title of th ejob for which the interview report is generated"),
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
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    // ❌ REMOVE schema for now (important for debugging)
  });

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

  return parsed;
}

// html to pdf
async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: "new",
      timeout: 60000
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

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(resumePdfSchema),
        }
    })


    const jsonContent = JSON.parse(response.text)

    const pdfBuffer = await generatePdfFromHtml(jsonContent.html)

    return pdfBuffer

}


module.exports={generateInterviewReport,generateResumePdf,generatePdfFromHtml}