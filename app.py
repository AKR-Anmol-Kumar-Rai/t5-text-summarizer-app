from fastapi import Request,FastAPI
from pydantic import BaseModel
from transformers import T5Tokenizer,Trainer,T5ForConditionalGeneration,TrainingArguments
import re
import torch
from fastapi.templating import Jinja2Templates as StarletteTemplates
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


# initializing our fastapi app

app=FastAPI(title="Text Summarizer App",description="Text Summarization using T5",version="1.0")

# loading model and tokenizer

model=T5ForConditionalGeneration.from_pretrained("./saved_summary_model") 
tokenizer=T5Tokenizer.from_pretrained("./saved_summary_model")


# defining device

if torch.cuda.is_available():
    device=torch.device("cuda")
else:
     device=torch.device("cpu")

print("device:",device)
model.to(device)

# templating
templates=StarletteTemplates(directory="templates")

# Input schema for dialogue => string
class DialogueInput(BaseModel):
     dialogue:str


#defining clean data function  
def clean_data(text):
    text=re.sub(r"\r\n"," ",text)    #lines
    text=re.sub(r"\s+"," ",text)    #spaces
    text=re.sub(r"<.*?>"," ",text)    #html tags
    text=text.strip().lower()    #removes staing and the ending spaces
    return text

# summarization function
def summarize_dialogue(dialogue : str):
    dialogue=clean_data(dialogue)  #clean

    # tokenize
    inputs=tokenizer(dialogue,padding="max_length",
                    max_length=512,truncation=True,
                    return_tensors="pt").to(device)  #by default hugging transformers are pytorch models so we return tensors
    
   
    # geneating summary
    model.to(device)
    targets=model.generate(        #target has tokens id
        input_ids=inputs["input_ids"],
        attention_mask=inputs["attention_mask"],
        max_length=150,
        num_beams=4,
        early_stopping=True
    ).to(device)  


   # (but answers are in token so we need to convert it itno the text using decoding)
    summary=tokenizer.decode(targets[0],skip_special_tokens=True)
    return summary


# API Endpoints (most important thing)
@app.post("/summarize/")
async def summarize(dialogue_input : DialogueInput):
    summary=summarize_dialogue(dialogue_input.dialogue)
    return {"summary": summary}

app.mount("/static", StaticFiles(directory="static"), name="static")
@app.get("/")
async def home():
    return FileResponse("templates/index.html")