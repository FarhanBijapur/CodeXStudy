"use client";

import type { MouseEvent } from 'react';
import { useState, useEffect, useCallback } from 'react';
import type { ScheduleTask, QuizQuestion, Quiz } from '@/types';
import { generateTaskQuiz, type GenerateTaskQuizInput } from '@/ai/flows/generate-task-quiz-flow';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, RotateCcw, CheckCircle, XCircle, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from "@/lib/utils";

interface QuizModalProps {
  task: ScheduleTask | null;
  subjectContext: string | undefined;
  isOpen: boolean;
  onClose: () => void;
  onQuizComplete: (taskId: string, score: number, attempted: boolean) => void;
}

type QuizState = 'loading' | 'taking' | 'results' | 'error';

export function QuizModal({ task, subjectContext, isOpen, onClose, onQuizComplete }: QuizModalProps) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [questionId: string]: number }>({});
  const [quizState, setQuizState] = useState<QuizState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewQuestionIndex, setReviewQuestionIndex] = useState(0);


  const loadQuiz = useCallback(async () => {
    if (!task || !subjectContext) {
      setErrorMessage("Task or subject context is missing.");
      setQuizState('error');
      return;
    }
    setQuizState('loading');
    setQuiz(null);
    setSelectedAnswers({});
    setCurrentQuestionIndex(0);
    setFinalScore(null);
    setErrorMessage(null);
    setIsReviewing(false);
    setReviewQuestionIndex(0);

    try {
      const input: GenerateTaskQuizInput = {
        taskText: task.task,
        subjectContext: subjectContext,
      };
      const result = await generateTaskQuiz(input);
      const parsedQuiz: Quiz = JSON.parse(result.quizJson);
      if (parsedQuiz && parsedQuiz.length > 0) {
        setQuiz(parsedQuiz);
        setQuizState('taking');
      } else {
        setErrorMessage("The AI generated an empty quiz. Please try again.");
        setQuizState('error');
      }
    } catch (err) {
      console.error("Failed to generate or parse quiz:", err);
      const defaultError = "Failed to load quiz. The AI might be busy or the topic too complex for a quick quiz. Try again later.";
      if (err instanceof Error) {
        if (err.message.includes("JSON.parse")) {
           setErrorMessage("AI returned an invalid quiz format. Please try again.");
        } else if (err.message.toLowerCase().includes("candidate was blocked")) {
           setErrorMessage("Quiz generation was blocked due to content policy. Please ensure the task is appropriate.");
        }
         else {
           setErrorMessage(err.message.length < 150 ? err.message : defaultError);
        }
      } else {
         setErrorMessage(defaultError);
      }
      setQuizState('error');
    }
  }, [task, subjectContext]);

  useEffect(() => {
    if (isOpen && task) {
      loadQuiz();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, task]);

  const handleAnswerSelect = (questionId: string, optionIndex: number) => {
    setSelectedAnswers(prev => ({ ...prev, [questionId]: optionIndex }));
  };

  const handleSubmitQuiz = () => {
    if (!quiz) return;
    let correctAnswers = 0;
    quiz.forEach(q => {
      if (selectedAnswers[q.id] === q.correctOptionIndex) {
        correctAnswers++;
      }
    });
    const score = Math.round((correctAnswers / quiz.length) * 100);
    setFinalScore(score);
    setQuizState('results');
    setIsReviewing(false);
    if (task) {
      onQuizComplete(task.id, score, true);
    }
  };

  const handleNextQuestion = () => {
    if (quiz && currentQuestionIndex < quiz.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };
  
  const handleNextReviewQuestion = () => {
    if (quiz && reviewQuestionIndex < quiz.length - 1) {
      setReviewQuestionIndex(prev => prev + 1);
    }
  };

  const handlePreviousReviewQuestion = () => {
    if (reviewQuestionIndex > 0) {
      setReviewQuestionIndex(prev => prev - 1);
    }
  };

  const handleModalClose = (event?: MouseEvent<HTMLButtonElement>) => {
    if(event) event.stopPropagation();
    setQuiz(null); 
    setQuizState('loading'); 
    setIsReviewing(false);
    onClose();
  };


  const currentTakingQuestion = quiz && quizState === 'taking' ? quiz[currentQuestionIndex] : null;
  const currentReviewQuestion = quiz && quizState === 'results' && isReviewing ? quiz[reviewQuestionIndex] : null;

  const getOptionStyling = (question: QuizQuestion, optionIndex: number) => {
    const isSelectedByUser = selectedAnswers[question.id] === optionIndex;
    const isCorrect = question.correctOptionIndex === optionIndex;

    if (isSelectedByUser && isCorrect) {
      return "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400";
    }
    if (isSelectedByUser && !isCorrect) {
      return "border-destructive bg-destructive/10 text-destructive";
    }
    if (isCorrect) { // Not selected by user, but is the correct one
      return "border-green-500 bg-green-500/5 text-green-600 dark:text-green-500";
    }
    return "border-input";
  };


  const renderContent = () => {
    switch (quizState) {
      case 'loading':
        return (
          <div className="flex flex-col items-center justify-center h-64">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Generating your quiz...</p>
          </div>
        );
      case 'error':
        return (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <p className="text-destructive font-semibold">Error Loading Quiz</p>
            <p className="text-muted-foreground text-sm mb-4">{errorMessage || "An unknown error occurred."}</p>
            <Button onClick={loadQuiz} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" /> Try Again
            </Button>
          </div>
        );
      case 'taking':
        if (!currentTakingQuestion) return <p>Error: Question not found.</p>;
        return (
          <div className="space-y-6">
            <Progress value={((currentQuestionIndex + 1) / (quiz?.length || 1)) * 100} className="w-full h-2" />
            <div>
              <p className="text-sm text-muted-foreground mb-1">Question {currentQuestionIndex + 1} of {quiz?.length}</p>
              <p className="font-semibold text-lg">{currentTakingQuestion.questionText}</p>
            </div>
            <RadioGroup
              value={selectedAnswers[currentTakingQuestion.id]?.toString()}
              onValueChange={(value) => handleAnswerSelect(currentTakingQuestion.id, parseInt(value))}
              className="space-y-2"
            >
              {currentTakingQuestion.options.map((option, index) => (
                <Label
                  key={index}
                  htmlFor={`option-${currentTakingQuestion.id}-${index}`}
                  className={`flex items-center space-x-3 p-3 border rounded-md cursor-pointer transition-all hover:bg-muted/50
                              ${selectedAnswers[currentTakingQuestion.id] === index ? 'border-primary bg-primary/10' : 'border-input'}`}
                >
                  <RadioGroupItem value={index.toString()} id={`option-${currentTakingQuestion.id}-${index}`} />
                  <span>{option}</span>
                </Label>
              ))}
            </RadioGroup>
          </div>
        );
      case 'results':
        if (isReviewing && currentReviewQuestion) {
          return (
            <div className="space-y-4">
              <Progress value={((reviewQuestionIndex + 1) / (quiz?.length || 1)) * 100} className="w-full h-2" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Reviewing Question {reviewQuestionIndex + 1} of {quiz?.length}</p>
                <p className="font-semibold text-lg">{currentReviewQuestion.questionText}</p>
              </div>
              <div className="space-y-2">
                {currentReviewQuestion.options.map((option, index) => {
                  const styling = getOptionStyling(currentReviewQuestion, index);
                  const isSelected = selectedAnswers[currentReviewQuestion.id] === index;
                  const isCorrect = currentReviewQuestion.correctOptionIndex === index;
                  return (
                    <div
                      key={`review-${index}`}
                      className={cn("flex items-center justify-between p-3 border rounded-md", styling)}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected && !isCorrect && <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />}
                        {isCorrect && <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />}
                        {!isCorrect && !isSelected && <div className="h-5 w-5 flex-shrink-0"></div>} {/* Placeholder for alignment */}
                        <span>{option}</span>
                      </div>
                      {isSelected && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300">Your Answer</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        // Score Summary
        return (
          <div className="text-center space-y-4 py-8">
            {finalScore !== null && finalScore >= 70 ? (
                 <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            ) : (
                 <XCircle className="h-16 w-16 text-destructive mx-auto" />
            )}
            <h3 className="text-2xl font-bold">Quiz Completed!</h3>
            <p className="text-4xl font-bold text-primary">{finalScore}%</p>
            <p className="text-muted-foreground">You answered {quiz?.filter(q => selectedAnswers[q.id] === q.correctOptionIndex).length} out of {quiz?.length} questions correctly.</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={() => { setIsReviewing(true); setReviewQuestionIndex(0); }} variant="outline" className="w-full sm:w-auto">
                <Eye className="mr-2 h-4 w-4" /> Review Answers
              </Button>
              <Button onClick={loadQuiz} variant="outline" className="w-full sm:w-auto">
                <RotateCcw className="mr-2 h-4 w-4" /> Take New Quiz
              </Button>
            </div>
          </div>
        );
    }
  };

  if (!isOpen || !task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleModalClose()}>
      <DialogContent className="sm:max-w-lg md:max-w-xl lg:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Quiz: {task.task}</DialogTitle>
          {(quizState === 'taking' || (quizState === 'results' && isReviewing)) && subjectContext && (
            <DialogDescription>
              Subject: {subjectContext}. {quizState === 'taking' ? "Test your knowledge!" : "Reviewing your answers."}
            </DialogDescription>
          )}
        </DialogHeader>
        
        <div className="flex-grow overflow-y-auto py-4 pr-2 nice-scrollbar">
            {renderContent()}
        </div>

        {quizState === 'taking' && (
          <DialogFooter className="sm:justify-between gap-2">
            <Button 
              variant="outline" 
              onClick={handlePreviousQuestion} 
              disabled={currentQuestionIndex === 0}
            >
              <ChevronLeft className="mr-1 h-4 w-4"/> Previous
            </Button>
            {currentQuestionIndex < (quiz?.length || 0) - 1 ? (
              <Button onClick={handleNextQuestion} disabled={selectedAnswers[currentTakingQuestion!.id] === undefined}>Next <ChevronRight className="ml-1 h-4 w-4"/></Button>
            ) : (
              <Button onClick={handleSubmitQuiz} disabled={selectedAnswers[currentTakingQuestion!.id] === undefined}>Submit Quiz</Button>
            )}
          </DialogFooter>
        )}
        {quizState === 'results' && isReviewing && (
          <DialogFooter className="sm:justify-between gap-2">
            <Button 
              variant="outline" 
              onClick={handlePreviousReviewQuestion} 
              disabled={reviewQuestionIndex === 0}
            >
              <ChevronLeft className="mr-1 h-4 w-4"/> Previous
            </Button>
            <Button onClick={() => setIsReviewing(false)}>Back to Score Summary</Button>
            <Button 
              variant="outline" 
              onClick={handleNextReviewQuestion} 
              disabled={!quiz || reviewQuestionIndex >= quiz.length - 1}
            >
              Next <ChevronRight className="ml-1 h-4 w-4"/>
            </Button>
          </DialogFooter>
        )}
         {(quizState === 'results' && !isReviewing || quizState === 'error') && (
            <DialogFooter>
                 <DialogClose asChild>
                    <Button type="button" variant="outline" onClick={handleModalClose}>Close</Button>
                </DialogClose>
            </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
