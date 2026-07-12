# QuizForge

QuizForge turns your own lecture notes into a polished multiple-choice quiz. You copy a prompt, run it through any AI chatbot together with your slides, and paste the result back into the site to practice. It's a single static folder with no server and no build step, so you can open it locally or host it for free.

## How a student uses it

1. Open the site and press **Copy prompt**.
2. Paste the prompt into your favorite AI chatbot along with your lecture slides or notes. The chatbot writes the quiz and hands back a block of JSON.
3. Paste that JSON into the **Paste your quiz** box and press **Load**. The quiz shows up in your library. Click **Take** to start, answer the questions, and submit to see your score.

Each quiz you load stays in your library, and every attempt adds to its score history so you can see how you're doing over time.

## Where your data lives

Everything runs in your browser. Quizzes and scores are saved to the browser's own storage (localStorage), and nothing is uploaded anywhere. That has two practical effects: your library is private to the device and browser you're using, and clearing your browser data will wipe it. Use the **Export** button on any quiz card to save a copy of its JSON that you can reload later or share.

## Known limitation: text only

Questions are text. Chatbots paste text, not slide images, so a diagram from your slides won't come across on its own. If you really need a picture in a question, an advanced user can hand-edit the quiz JSON and drop a `data:` image URI into an `explanation` field before loading it. For everyday use, plain text questions cover the ground.
