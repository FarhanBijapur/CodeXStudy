
"use client";
import * as React from 'react';
import { useState, useEffect, useMemo, ChangeEvent, useCallback } from 'react';
import AppLayout from "@/components/AppLayout";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from "@/components/ui/label";
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle, Trash2, Edit3, CalendarIcon as CalendarDaysIcon, Search, ChevronLeft, ChevronRight, ListTree, FileQuestion, PlusCircle, Info, FileText, AlertCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { generateStudySchedule, type GenerateStudyScheduleInput, type GenerateStudyScheduleOutput } from "@/ai/flows/generate-study-schedule";
import type { PlanInput, ScheduleData, ScheduleTask, ParsedRawScheduleItem, SubTask } from "@/types";
import { type AdaptiveRePlanningOutput } from "@/ai/flows/adaptive-re-planning";
import { useAuth } from '@/contexts/auth-context';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as ShadCalendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { format, parseISO, addDays, subDays, startOfWeek, endOfWeek, isSameMonth, addMonths, subMonths, isValid, differenceInDays } from 'date-fns';
import { cn } from "@/lib/utils";
import { TaskBreakdownModal } from '@/components/task-breakdown-modal';
import { AdaptiveReplanModal } from '@/components/adaptive-replan-modal';
import { LogScorePopover } from '@/components/log-score-popover';
import { QuizModal } from '@/components/quiz-modal';
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useSearchParams } from 'next/navigation'; 

function parseTasksFromString(scheduleString: string, planId: string): ScheduleTask[] {
  try {
    const parsed = JSON.parse(scheduleString) as ParsedRawScheduleItem[];
    if (Array.isArray(parsed) && parsed.every(item => typeof item.date === 'string' && typeof item.task === 'string')) {
      return parsed.map((item, index) => {
        // For a new or revised schedule, we always create new tasks with new IDs and completed: false state.
        return {
          date: item.date,
          task: item.task,
          id: `task-${planId}-${new Date(item.date).getTime()}-${index}-${Math.random().toString(36).substring(2,9)}`, // More unique ID
          completed: false, // ALL tasks in a new/revised schedule start as incomplete.
          youtubeSearchQuery: item.youtubeSearchQuery,
          referenceSearchQuery: item.referenceSearchQuery,
          subTasks: [], // Sub-tasks are not carried over in a re-plan for simplicity. Can be added later.
          quizScore: undefined,
          quizAttempted: false,
          notes: undefined,
        };
      });
    }
    console.warn("[PlannerPage ParseTasks] Schedule string did not parse into expected array of objects. String:", scheduleString.substring(0,100));
    return []; // Return empty array on failure
  } catch (error) {
    console.warn("[PlannerPage ParseTasks] Failed to parse schedule string:", error, "String was:", scheduleString.substring(0,100));
    return []; // Return empty array on failure
  }
}

const initialPlannerData: PlanInput = {
  subjects: '',
  studyDurationDays: 30,
  dailyStudyHours: 3,
  subjectDetails: '',
  startDate: format(new Date(), 'yyyy-MM-dd'), 
};

export default function PlannerPage() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const planIdFromQuery = searchParams.get('planId');
  
  const [currentStep, setCurrentStep] = useState(1); 
  const [plannerFormInput, setPlannerFormInput] = useState<PlanInput>({...initialPlannerData});
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | undefined>(new Date()); 
  
  const [isAnalyzing, setIsAnalyzing] = useState(false); 
  const [isLoadingPlans, setIsLoadingPlans] = useState(true); 

  const [allUserPlans, setAllUserPlans] = useState<ScheduleData[]>([]);
  const [activePlan, setActivePlan] = useState<ScheduleData | null>(null);

  const [calendarSelectedDateForDisplay, setCalendarSelectedDateForDisplay] = useState<Date | undefined>(new Date());
  const [calendarDisplayMonth, setCalendarDisplayMonth] = useState(new Date());
  const [isBreakdownModalOpen, setIsBreakdownModalOpen] = useState(false);
  const [selectedTaskForBreakdown, setSelectedTaskForBreakdown] = useState<ScheduleTask | null>(null);
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);
  const [selectedTaskForQuiz, setSelectedTaskForQuiz] = useState<ScheduleTask | null>(null);

  const [editingNoteTask, setEditingNoteTask] = useState<ScheduleTask | null>(null);
  const [currentNoteText, setCurrentNoteText] = useState<string>("");
  
  const [showReplanSuggestion, setShowReplanSuggestion] = useState(false);
  const [daysBehind, setDaysBehind] = useState(0);


  const fetchUserPlans = useCallback(async () => {
    if (!currentUser?.id) {
      setAllUserPlans([]);
      setActivePlan(null);
      setCurrentStep(1);
      setIsLoadingPlans(false);
      return;
    }
    setIsLoadingPlans(true);

    if (planIdFromQuery) { 
      try {
        const response = await fetch(`/api/plans/${planIdFromQuery}?userId=${currentUser.id}`);
        if (!response.ok) {
          let errorTitle = "Error Loading Plan";
          let errorDesc = `Failed to fetch plan ${planIdFromQuery}. Server responded with status: ${response.status}.`;
           if (response.status === 404) {
             errorTitle = "Plan Not Found";
             errorDesc = `The requested plan was not found or you're not authorized. Starting new plan creation.`;
           } else {
            try {
              const errorData = await response.json().catch(() => ({error: "Unknown error fetching specific plan"}));
              errorDesc = String(errorData.error || errorDesc);
            } catch (e) { /* Ignore if error response is not JSON */ }
          }
          toast({ title: errorTitle, description: errorDesc, variant: "destructive" });
          setActivePlan(null);
          setPlannerFormInput({...initialPlannerData}); 
          setCurrentStep(1);
          setIsLoadingPlans(false);
          return;
        }
        const plan: ScheduleData = await response.json();
        const processedPlan = {
          ...plan,
          tasks: (plan.tasks || []).map(t => ({
            ...t,
            subTasks: t.subTasks || [],
            quizAttempted: t.quizAttempted || false,
            notes: t.notes || undefined,
          }))
        };
        setActivePlan(processedPlan);
        setAllUserPlans(prev => { 
            const exists = prev.some(p => p.id === processedPlan.id);
            return exists ? prev.map(p => p.id === processedPlan.id ? processedPlan : p) : [...prev, processedPlan];
        });
        setPlannerFormInput(processedPlan.planDetails);
        const startDate = processedPlan.planDetails.startDate ? parseISO(processedPlan.planDetails.startDate) : new Date();
        if (isValid(startDate)) {
          setSelectedCalendarDate(startDate);
          setCalendarSelectedDateForDisplay(startDate);
          setCalendarDisplayMonth(startDate);
        }
        setCurrentStep(3);
      } catch (error) {
        console.error(`Failed to fetch plan ${planIdFromQuery}:`, error);
        toast({ title: "Error Loading Plan", description: (error as Error).message, variant: "destructive" });
        setActivePlan(null);
        setPlannerFormInput({...initialPlannerData});
        setCurrentStep(1);
      } finally {
        setIsLoadingPlans(false);
      }
    } else { 
      try {
        const response = await fetch(`/api/plans?userId=${currentUser.id}`);
        if (!response.ok) {
            let apiErrorMessage = "Failed to fetch plans from server.";
            let apiErrorDetails = `Server responded with status: ${response.status}.`;
            try {
              const errorData = await response.json();
              apiErrorMessage = String(errorData.error || apiErrorMessage);
              apiErrorDetails = String(errorData.details || apiErrorDetails);
            } catch (parseError) {
              apiErrorDetails = `Server returned status ${response.status} but the error message was not in the expected JSON format. Please check server logs. (${response.statusText})`;
            }
            toast({ title: "Error Loading Plans", description: `${apiErrorMessage} ${apiErrorDetails}`, variant: "destructive" });
            throw new Error("Failed to fetch plans");
        }
        const plans: ScheduleData[] = await response.json();
        
        const processedPlans = plans.map(p => ({
            ...p,
            tasks: (p.tasks || []).map(t => ({
                ...t,
                subTasks: t.subTasks || [],
                quizAttempted: t.quizAttempted || false,
                notes: t.notes || undefined,
            }))
        }));
        setAllUserPlans(processedPlans);

        if (processedPlans.length > 0) {
          const currentActivePlan = processedPlans.find(p => p.status === 'active') || 
                         processedPlans.find(p => p.status === 'completed') || 
                         processedPlans.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
          
          setActivePlan(currentActivePlan || null);
          if (currentActivePlan) {
            setPlannerFormInput(currentActivePlan.planDetails);
            const startDate = currentActivePlan.planDetails.startDate ? parseISO(currentActivePlan.planDetails.startDate) : new Date();
            if (isValid(startDate)) {
              setSelectedCalendarDate(startDate);
              setCalendarSelectedDateForDisplay(startDate);
              setCalendarDisplayMonth(startDate);
            }
            setCurrentStep(3);
          } else {
            setCurrentStep(1); 
            setPlannerFormInput({...initialPlannerData});
            setSelectedCalendarDate(new Date());
          }
        } else {
          setActivePlan(null);
          setPlannerFormInput({...initialPlannerData});
          setSelectedCalendarDate(new Date());
          setCurrentStep(1);
        }
      } catch (error) {
        console.error("Failed to fetch user plans:", error);
        if (!(error instanceof Error && error.message.includes("Failed to fetch plans"))) { // Avoid double toast
            toast({ title: "Error Loading Plans", description: (error as Error).message, variant: "destructive" });
        }
        setAllUserPlans([]);
        setActivePlan(null);
        setCurrentStep(1);
      } finally {
        setIsLoadingPlans(false);
      }
    }
  }, [currentUser, toast, planIdFromQuery]); 

  useEffect(() => {
    fetchUserPlans();
  }, [fetchUserPlans]);

  // useEffect to detect if user is behind schedule
  useEffect(() => {
    if (activePlan && activePlan.status === 'active' && activePlan.tasks.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize today to the start of the day

      const firstUncompletedTask = activePlan.tasks
        .filter(t => !t.completed && t.date && isValid(parseISO(t.date)))
        .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())[0];

      if (firstUncompletedTask) {
        const taskDate = parseISO(firstUncompletedTask.date);
        
        if (taskDate < today) {
          const diff = differenceInDays(today, taskDate);
          setDaysBehind(diff > 0 ? diff : 1);
          setShowReplanSuggestion(true);
        } else {
          setShowReplanSuggestion(false);
        }
      } else {
        // All tasks are completed
        setShowReplanSuggestion(false);
      }
    } else {
      setShowReplanSuggestion(false);
    }
  }, [activePlan]);


  const saveActivePlanChanges = useCallback(async (planToSave: ScheduleData | null = activePlan) => {
    if (!planToSave || !currentUser?.id) {
      toast({ title: "Error", description: "No active plan or user to save changes for.", variant: "destructive" });
      return false;
    }
    setIsAnalyzing(true); 
    try {
      const response = await fetch(`/api/plans/${planToSave.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, planData: planToSave }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save plan: ${response.statusText}`);
      }
      const updatedPlanFromServer: ScheduleData = await response.json();
      
      const processedUpdatedPlan = {
          ...updatedPlanFromServer,
          tasks: (updatedPlanFromServer.tasks || []).map(t => ({
              ...t,
              subTasks: t.subTasks || [],
              quizAttempted: t.quizAttempted || false,
              notes: t.notes || undefined,
          }))
      };

      setActivePlan(processedUpdatedPlan);
      setAllUserPlans(prevPlans => prevPlans.map(p => p.id === processedUpdatedPlan.id ? processedUpdatedPlan : p));
      window.dispatchEvent(new CustomEvent('studyPlanUpdated')); 
      setIsAnalyzing(false);
      return true;
    } catch (error) {
      console.error("Failed to save plan changes:", error);
      toast({ title: "Error Saving Plan", description: (error as Error).message, variant: "destructive" });
      setIsAnalyzing(false);
      return false;
    }
  }, [activePlan, currentUser?.id, toast]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setPlannerFormInput(prev => ({
      ...prev,
      [id]: (id === 'studyDurationDays' || id === 'dailyStudyHours') ? parseFloat(value) || 0 : value
    }));
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedCalendarDate(date); 
    setPlannerFormInput(prev => ({
      ...prev,
      startDate: date ? format(date, 'yyyy-MM-dd') : undefined,
    }));
  };

  const handleSelectChange = (id: string, value: string) => {
     if (id === 'dailyStudyHours') {
      setPlannerFormInput(prev => ({ ...prev, dailyStudyHours: parseFloat(value) }));
    }
  };

  const validateInputs = (): { valid: boolean; field?: keyof PlanInput; message: string } => {
    if (!plannerFormInput.subjects.trim()) return { valid: false, field: "subjects", message: "Please enter subjects." };
    if (plannerFormInput.studyDurationDays <= 0) return { valid: false, field: "studyDurationDays", message: "Duration must be > 0 days." };
    if (plannerFormInput.dailyStudyHours <= 0) return { valid: false, field: "dailyStudyHours", message: "Hours must be > 0." };
    if (!plannerFormInput.startDate) return { valid: false, field: "startDate", message: "Please select a start date." };
    return { valid: true, message: "" };
  };

  const startAnalysisAndGeneratePlan = async () => {
    if (!currentUser?.id || !currentUser.email || !currentUser.name) {
      toast({ title: "User not authenticated", description: "Please log in to create a plan.", variant: "destructive" });
      return;
    }
    const validationResult = validateInputs();
    if (!validationResult.valid) {
      toast({ title: `Invalid Input: ${validationResult.field || 'Field'}`, description: validationResult.message, variant: "destructive" });
      return;
    }

    setCurrentStep(2);
    setIsAnalyzing(true);

    try {
      const aiInput: GenerateStudyScheduleInput = { ...plannerFormInput, startDate: plannerFormInput.startDate! };
      const result: GenerateStudyScheduleOutput = await generateStudySchedule(aiInput);

      if (result && result.schedule) {
        const now = new Date().toISOString();
        const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2,9)}`;
        
        const newPlanData: ScheduleData = {
          id: planId,
          createdAt: now,
          updatedAt: now,
          scheduleString: result.schedule,
          tasks: parseTasksFromString(result.schedule, planId), 
          planDetails: { ...plannerFormInput, startDate: plannerFormInput.startDate! },
          status: 'active',
        };

        const response = await fetch('/api/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, planData: newPlanData }),
        });

        if (response.ok) {
            try {
                await fetch('/api/send-plan-creation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: currentUser.email,
                        name: currentUser.name,
                        planDetails: newPlanData.planDetails
                    }),
                });
            } catch (emailError) {
                console.warn("Failed to dispatch plan creation email:", emailError);
            }
            toast({ title: "Study Plan Generated!", description: "Your new study plan is ready.", variant: "default", action: <CheckCircle className="text-green-500"/> });
            await fetchUserPlans();
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to create plan: ${response.statusText}`);
        }
      } else {
        throw new Error("AI did not return a schedule.");
      }
    } catch (error: any) {
      console.error("Error generating study plan:", error);
      toast({ title: "Planning Failed", description: (error as Error).message || "Could not generate the plan.", variant: "destructive" });
      setCurrentStep(1);
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  const handleSaveSubTasks = (updatedTaskFromModal: ScheduleTask) => {
    if (!activePlan) return;
    const updatedTasks = activePlan.tasks.map(t =>
      t.id === updatedTaskFromModal.id ? updatedTaskFromModal : t
    );
    const updatedPlan = {...activePlan, tasks: updatedTasks, updatedAt: new Date().toISOString()};
    setActivePlan(updatedPlan); 
    saveActivePlanChanges(updatedPlan).then(success => {
        if(success) toast({ title: "Sub-tasks updated", description: `Changes saved for task "${updatedTaskFromModal.task.substring(0,30)}...".`});
        else fetchUserPlans(); 
    });
    setIsBreakdownModalOpen(false);
    setSelectedTaskForBreakdown(null);
  };

  const handleSaveQuizScore = (taskId: string, score: number | undefined, attempted: boolean) => {
     if (!activePlan) return;
      const updatedTasks = activePlan.tasks.map(t =>
        t.id === taskId ? { ...t, quizScore: score, quizAttempted: attempted } : t
      );
      const updatedPlan = {...activePlan, tasks: updatedTasks, updatedAt: new Date().toISOString()};
      setActivePlan(updatedPlan); 
      saveActivePlanChanges(updatedPlan).then(success => {
         if (!success) fetchUserPlans(); 
      });
  };

  const handleReplanSuccess = useCallback(async (revisedData: AdaptiveRePlanningOutput, newDurationDays: number) => {
    if (!activePlan || !activePlan.planDetails || !currentUser?.id) {
        toast({ title: "Error", description: "Cannot re-plan without an active plan and user session.", variant: "destructive" });
        return;
    }

    setIsAnalyzing(true);
    try {
        const now = new Date().toISOString();
        const updatedPlanDetails: PlanInput = {
            ...activePlan.planDetails,
            studyDurationDays: newDurationDays,
            startDate: format(new Date(), 'yyyy-MM-dd'),
        };
        const revisedTasks = parseTasksFromString(revisedData.revisedSchedule, activePlan.id);

        const replannedData: ScheduleData = {
            id: activePlan.id,
            createdAt: activePlan.createdAt,
            updatedAt: now,
            scheduleString: revisedData.revisedSchedule,
            tasks: revisedTasks,
            planDetails: updatedPlanDetails,
            status: 'active',
        };
        
        const response = await fetch(`/api/plans/${activePlan.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, planData: replannedData }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to save revised plan: ${response.statusText}`);
        }
        
        const updatedPlanFromServer: ScheduleData = await response.json();
        
        const processedPlan = {
            ...updatedPlanFromServer,
            tasks: (updatedPlanFromServer.tasks || []).map(t => ({
                ...t,
                subTasks: t.subTasks || [],
                quizAttempted: t.quizAttempted || false,
                notes: t.notes || undefined,
            }))
        };
        
        setActivePlan(processedPlan);
        setAllUserPlans(prev => prev.map(p => p.id === processedPlan.id ? processedPlan : p));

        toast({ title: "Plan Revised", description: revisedData.summary || "Your study plan has been updated." });
        
        const newStartDate = revisedTasks.length > 0 && isValid(parseISO(revisedTasks[0].date)) 
            ? parseISO(revisedTasks[0].date) 
            : new Date();
        setCalendarSelectedDateForDisplay(newStartDate);
        setCalendarDisplayMonth(newStartDate);
        
        window.dispatchEvent(new CustomEvent('studyPlanUpdated'));

    } catch (error) {
        console.error("Failed during re-plan process:", error);
        toast({ title: "Error Revising Plan", description: (error as Error).message, variant: "destructive" });
    } finally {
        setIsAnalyzing(false);
    }
  }, [activePlan, currentUser, toast]);

  const startNewPlanCreation = () => {
    setActivePlan(null); 
    setPlannerFormInput({...initialPlannerData}); 
    setSelectedCalendarDate(new Date()); 
    setCalendarSelectedDateForDisplay(new Date()); 
    setCalendarDisplayMonth(new Date());
    setCurrentStep(1);
  };

  const handleDeletePlan = async () => {
    if (!activePlan || !currentUser?.id) return;
    setIsAnalyzing(true);
    try {
        const response = await fetch(`/api/plans/${activePlan.id}?userId=${currentUser.id}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to delete plan.");
        }
        toast({ title: "Plan Deleted", description: "The study plan has been removed.", variant: "default" });
        await fetchUserPlans(); 
    } catch (error) {
        console.error("Error deleting plan:", error);
        toast({ title: "Error Deleting Plan", description: (error as Error).message, variant: "destructive" });
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleMarkPlanAsCompleted = async () => {
    if (activePlan && currentUser?.id && currentUser.email && currentUser.name) {
      const now = new Date().toISOString();
      const completedPlan: ScheduleData = {
        ...activePlan,
        status: 'completed',
        completionDate: now,
        updatedAt: now,
      };
      setActivePlan(completedPlan); 
      const success = await saveActivePlanChanges(completedPlan);
      if (success) {
        try {
            await fetch('/api/send-plan-completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: currentUser.email,
                    name: currentUser.name,
                    planDetails: completedPlan.planDetails,
                }),
            });
        } catch (emailError) {
            console.warn("Failed to dispatch plan completion email:", emailError);
        }
        toast({ title: "Plan Marked as Completed!", description: "Congratulations!", variant: "default" });
      } else {
        fetchUserPlans(); 
      }
    }
  };
  
  const getTasksForDate = (date: Date | undefined): ScheduleTask[] => {
    if (!date || !activePlan || !activePlan.tasks) return [];
    const dateString = format(date, 'yyyy-MM-dd');
    return activePlan.tasks.filter(task => {
        try {
            return format(parseISO(task.date), 'yyyy-MM-dd') === dateString;
        } catch (e) {
            console.warn(`Error parsing task.date "${task.date}" for task ID ${task.id}`, e);
            return false;
        }
    });
  };

  const handleCalendarTaskToggle = (taskId: string) => {
    if (!activePlan || activePlan.status === 'completed' || activePlan.status === 'archived') {
      toast({ title: "Action Restricted", description: "Cannot modify tasks for a completed/archived plan.", variant: "default" });
      return;
    }
    const updatedTasks = activePlan.tasks.map((task) => task.id === taskId ? { ...task, completed: !task.completed } : task );
    const updatedPlan = {...activePlan, tasks: updatedTasks, updatedAt: new Date().toISOString()};
    setActivePlan(updatedPlan); 
    
    saveActivePlanChanges(updatedPlan).then(success => {
        if (success) {
            const changedTask = updatedTasks.find(t => t.id === taskId);
            toast({ title: `Task ${changedTask?.completed ? 'Completed' : 'Marked Incomplete'}`, description: `"${changedTask?.task.substring(0,30)}..." status updated.`, variant: "default" });
        } else {
            fetchUserPlans(); 
        }
    });
  };

  const handleOpenBreakdownModal = (task: ScheduleTask) => { setSelectedTaskForBreakdown(task); setIsBreakdownModalOpen(true); };
  const handleOpenQuizModal = (task: ScheduleTask) => { setSelectedTaskForQuiz(task); setIsQuizModalOpen(true); };

  const handleOpenNotesPopover = (task: ScheduleTask) => {
    setEditingNoteTask(task);
    setCurrentNoteText(task.notes || "");
  };

  const handleSaveNote = () => {
    if (!activePlan || !editingNoteTask) return;
    const updatedTasks = activePlan.tasks.map(t =>
      t.id === editingNoteTask.id ? { ...t, notes: currentNoteText.trim() === "" ? undefined : currentNoteText.trim() } : t
    );
    const updatedPlan = { ...activePlan, tasks: updatedTasks, updatedAt: new Date().toISOString() };
    setActivePlan(updatedPlan);
    saveActivePlanChanges(updatedPlan).then(success => {
      if (success) toast({ title: "Note Saved" });
      else fetchUserPlans(); 
    });
    setEditingNoteTask(null); 
    setCurrentNoteText("");
  };


  if (isLoadingPlans && !activePlan && !planIdFromQuery) { 
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <>
            <div className="space-y-1">
              <Label htmlFor="subjects">Subjects & Priority</Label>
              <Input type="text" id="subjects" placeholder="e.g., Math (1), Physics (2)" value={plannerFormInput.subjects} onChange={handleInputChange} />
               <p className="text-xs text-muted-foreground">Enter subjects, add priority in ( ) - lower is higher. Ex: Chem (1), Bio (2).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="startDate">Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !selectedCalendarDate && "text-muted-foreground")}>
                    <CalendarDaysIcon className="mr-2 h-4 w-4" />
                    {selectedCalendarDate && isValid(selectedCalendarDate) ? format(selectedCalendarDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <ShadCalendar mode="single" selected={selectedCalendarDate} onSelect={handleDateSelect} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label htmlFor="subjectDetails">Subject Details (Optional)</Label>
              <Textarea id="subjectDetails" placeholder="e.g., Math: Algebra Ch 1-3. Physics: Kinematics." value={plannerFormInput.subjectDetails || ""} onChange={handleInputChange} rows={3} />
               <p className="text-xs text-muted-foreground">Specific topics for detailed planning.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="studyDurationDays">Study Duration (Days)</Label>
              <Input type="number" id="studyDurationDays" value={plannerFormInput.studyDurationDays} onChange={handleInputChange} min="1" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dailyStudyHours">Daily Study Hours</Label>
              <Select value={String(plannerFormInput.dailyStudyHours)} onValueChange={(value) => handleSelectChange('dailyStudyHours', value)}>
                  <SelectTrigger id="dailyStudyHours"><SelectValue placeholder="Select hours" /></SelectTrigger>
                  <SelectContent>{[1,1.5,2,2.5,3,3.5,4,4.5,5,6,7,8].map(h => <SelectItem key={h} value={String(h)}>{h} hour{h > 1 ? 's' : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={startAnalysisAndGeneratePlan} className="w-full" disabled={isAnalyzing}>
              {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
              Generate New Plan
            </Button>
             {activePlan && ( 
                <Button onClick={() => {
                    if (activePlan) {
                        setPlannerFormInput(activePlan.planDetails);
                        const sDate = activePlan.planDetails.startDate ? parseISO(activePlan.planDetails.startDate) : new Date();
                        if(isValid(sDate)){
                            setSelectedCalendarDate(sDate); 
                            setCalendarSelectedDateForDisplay(sDate); 
                            setCalendarDisplayMonth(sDate);
                        }
                        setCurrentStep(3);
                    }
                }} variant="outline" className="w-full">
                    Cancel & View Current Plan
                </Button>
            )}
          </>
        );
      case 2:
        return (
          <div className="text-center py-10">
            <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-6" />
            <h3 className="text-xl font-semibold mb-2">AI Analysis in Progress...</h3>
            <p className="text-muted-foreground">Crafting your personalized study plan.</p>
          </div>
        );
      case 3:
        if (isLoadingPlans && !activePlan) {
             return <div className="flex items-center justify-center py-10"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;
        }
        if (!activePlan || !activePlan.planDetails) {
           return (
             <div className="text-center py-10">
               <Info className="h-12 w-12 text-primary mx-auto mb-4" />
               <h3 className="text-xl font-semibold mb-2">No Active Plan</h3>
               <p className="text-muted-foreground mb-4">You don't have an active study plan.</p>
               <Button onClick={startNewPlanCreation}><PlusCircle className="mr-2 h-4 w-4" /> Create New Plan</Button>
             </div>
           );
        }
            const tasksForSelectedDate = getTasksForDate(calendarSelectedDateForDisplay);
            let planStartDate: Date | null = null;
            let planEndDate: Date | null = null;
            if (activePlan.tasks.length > 0) {
                const sortedTasksByDate = [...activePlan.tasks].filter(t=> isValid(parseISO(t.date))).sort((a,b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
                if (sortedTasksByDate.length > 0) {
                  const firstTaskDate = parseISO(sortedTasksByDate[0].date);
                  const lastTaskDate = parseISO(sortedTasksByDate[sortedTasksByDate.length - 1].date);
                  if (isValid(firstTaskDate)) planStartDate = firstTaskDate;
                  if (isValid(lastTaskDate)) planEndDate = lastTaskDate;
                }
            }
             if (!planStartDate && activePlan.planDetails.startDate && isValid(parseISO(activePlan.planDetails.startDate))) {
                 planStartDate = parseISO(activePlan.planDetails.startDate);
             }
             if (!planStartDate) planStartDate = new Date(); 
             if (!planEndDate) planEndDate = addDays(planStartDate, activePlan.planDetails.studyDurationDays || 30);

          return (
            <>
              {showReplanSuggestion && activePlan && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>You seem to be behind schedule!</AlertTitle>
                  <AlertDescription className="flex items-center justify-between">
                    <span>Your next task was {daysBehind} day{daysBehind > 1 ? 's' : ''} ago. Consider re-planning to catch up.</span>
                    <AdaptiveReplanModal
                        originalScheduleJSON={JSON.stringify(activePlan.tasks)}
                        planDetails={activePlan.planDetails}
                        onReplanSuccess={handleReplanSuccess}
                        prefilledSkippedDays={daysBehind}
                    />
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col md:flex-row gap-6 -mx-6 -my-6 p-6 bg-muted/20 rounded-b-lg">
                <div className="md:w-[340px] flex-shrink-0 bg-card p-4 rounded-lg shadow">
                  <div className="flex items-center justify-between mb-3">
                      <Button variant="outline" size="icon" onClick={() => setCalendarDisplayMonth(subMonths(calendarDisplayMonth, 1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
                      <h2 className="text-lg font-semibold text-center">{isValid(calendarDisplayMonth) ? format(calendarDisplayMonth, 'MMMM yyyy') : "Loading..."}</h2>
                      <Button variant="outline" size="icon" onClick={() => setCalendarDisplayMonth(addMonths(calendarDisplayMonth, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                  <ShadCalendar
                    mode="single" selected={calendarSelectedDateForDisplay}
                    onSelect={(date) => { setCalendarSelectedDateForDisplay(date); if(date && isValid(date)) setCalendarDisplayMonth(date); }}
                    month={calendarDisplayMonth} onMonthChange={setCalendarDisplayMonth}
                    className="rounded-md border-0 shadow-none p-0"
                    disabled={date => (planStartDate && date < startOfWeek(planStartDate)) || (planEndDate && date > endOfWeek(planEndDate))}
                    components={{ DayContent: ({ date, activeModifiers }) => {
                        const tasksOnDay = getTasksForDate(date);
                        const isSel = activeModifiers.selected; const isToday = activeModifiers.today;
                        const isCurrMonth = isValid(date) && isValid(calendarDisplayMonth) && isSameMonth(date, calendarDisplayMonth);
                        return (<div className={`relative h-full w-full flex flex-col items-center justify-center ${!isCurrMonth ? 'text-muted-foreground/50' : ''}`}>
                            <span>{isValid(date) ? format(date, "d") : "X"}</span>
                            {tasksOnDay.length > 0 && (<div className={`absolute bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full ${isSel || isToday ? 'bg-primary-foreground dark:bg-primary' : 'bg-primary dark:bg-primary-foreground'}`}></div>)}
                          </div>);
                      },}}/>
                  <Button onClick={startNewPlanCreation} variant="outline" className="w-full mt-4"><PlusCircle className="mr-2 h-4 w-4" /> Create New Plan</Button>
                </div>
                <div className="flex-grow bg-card p-4 rounded-lg shadow min-h-[400px]">
                  {calendarSelectedDateForDisplay && isValid(calendarSelectedDateForDisplay) ? (<>
                          <h3 className="text-xl font-semibold mb-1">{format(calendarSelectedDateForDisplay, 'EEEE, MMMM d, yyyy')}</h3>
                          <p className="text-sm text-muted-foreground mb-4">Day {activePlan.tasks.findIndex(t => { try { return format(parseISO(t.date), 'yyyy-MM-dd') === format(calendarSelectedDateForDisplay, 'yyyy-MM-dd'); } catch { return false; } }) + 1} of {activePlan.planDetails.studyDurationDays}
                              {activePlan.status === 'completed' ? <span className="ml-2 text-green-600 font-semibold">(Completed)</span> : activePlan.status === 'archived' ? <span className="ml-2 text-gray-500 font-semibold">(Archived)</span> : ''}</p>
                          {tasksForSelectedDate.length > 0 ? (<ScrollArea className="h-[calc(100%-100px)] pr-3">{/* Adjust height as needed */}
                              <ul className="space-y-3">{tasksForSelectedDate.map(task => (<li key={`cal-task-${task.id}`} className={`flex items-start gap-3 text-sm p-3 rounded-md transition-all shadow-sm ${task.completed ? 'bg-green-500/10 line-through text-muted-foreground' : 'bg-background hover:bg-accent/30'}`}>
                                  <Checkbox id={`task-cal-${task.id}`} checked={task.completed} onCheckedChange={() => handleCalendarTaskToggle(task.id)} aria-labelledby={`task-cal-label-${task.id}`} disabled={activePlan?.status === 'completed' || activePlan?.status === 'archived'} className="mt-1"/>
                                  <div className="flex-1">
                                      <Label htmlFor={`task-cal-${task.id}`} id={`task-cal-label-${task.id}`} className={`font-medium ${(activePlan?.status === 'completed' || activePlan?.status === 'archived') ? 'cursor-default' : 'cursor-pointer'}`}>{task.task}</Label>
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                                        {(task.youtubeSearchQuery || task.referenceSearchQuery) && (<div className="flex gap-2">
                                          {task.youtubeSearchQuery && (<a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(task.youtubeSearchQuery)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-red-500 hover:text-red-600 hover:underline flex items-center gap-1" title={`Search YouTube: ${task.youtubeSearchQuery}`} onClick={(e) => e.stopPropagation()}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.04 6.5c.14-.48.49-.9.96-1.11a2.57 2.57 0 0 1 2.34.38l5.34 3.36a1.73 1.73 0 0 1 0 2.74l-5.34 3.36a2.57 2.57 0 0 1-2.34.38c-.47-.21-.82-.63-.96-1.11Z"/><path d="M17.55 17.28c-1.18.37-2.7.6-4.55.6-4.79 0-8.5-2.01-8.5-4.5s3.71-4.5 8.5-4.5c1.85 0 3.37.23 4.55.6Z"/><path d="M22 12a9.9 9.9 0 0 1-7.45 9.67A9.37 9.37 0 0 1 12 22c-5.23 0-9.5-2.12-9.5-4.72V16M2.5 12C2.5 7 7.5 3 12.5 3s10 4 10 9"/></svg> YT</a>)}
                                            {task.referenceSearchQuery && (<a href={`https://www.google.com/search?q=${encodeURIComponent(task.referenceSearchQuery)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1" title={`Search Web: ${task.referenceSearchQuery}`} onClick={(e) => e.stopPropagation()}><Search className="h-3 w-3"/> Web</a>)}
                                        </div>)}
                                        {(activePlan?.status !== 'completed' && activePlan?.status !== 'archived') && (<>
                                            <Button variant="ghost" size="sm" onClick={() => handleOpenBreakdownModal(task)} className="h-auto p-0 text-xs text-primary/70 hover:text-primary" title="Break down task"><ListTree className="mr-1 h-3 w-3"/> Sub-tasks ({(task.subTasks || []).length})</Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleOpenQuizModal(task)} className="h-auto p-0 text-xs text-purple-500 hover:text-purple-600" title="Take quiz"><FileQuestion className="mr-1 h-3 w-3"/> Take AI Quiz</Button>
                                            <LogScorePopover task={task} onSave={handleSaveQuizScore} onTakeQuiz={handleOpenQuizModal} disabled={activePlan?.status === 'completed' || activePlan?.status === 'archived'}/>
                                            <Popover open={editingNoteTask?.id === task.id} onOpenChange={(isOpen) => { if (!isOpen) { setEditingNoteTask(null); setCurrentNoteText(""); }}}>
                                              <PopoverTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-blue-500 hover:text-blue-600" title="Add/Edit Notes" onClick={() => handleOpenNotesPopover(task)} disabled={isAnalyzing || activePlan?.status === 'completed' || activePlan?.status === 'archived'}>
                                                  <FileText className="mr-1 h-3 w-3" /> Notes
                                                </Button>
                                              </PopoverTrigger>
                                              <PopoverContent className="w-96 z-50">
                                                <div className="grid gap-4">
                                                  <div className="space-y-2">
                                                    <h4 className="font-medium leading-none">Notes for task:</h4>
                                                    <p className="text-sm text-muted-foreground truncate" title={task.task}>{task.task.substring(0,50)}{task.task.length > 50 ? '...' : ''}</p>
                                                  </div>
                                                  <div className="grid gap-2">
                                                    <Textarea id={`notes-${task.id}`} value={currentNoteText} onChange={(e) => setCurrentNoteText(e.target.value)} placeholder="Type your short notes here..." rows={3} className="break-words w-full" />
                                                  </div>
                                                  <Button onClick={handleSaveNote} disabled={isAnalyzing}>Save Notes</Button>
                                                </div>
                                              </PopoverContent>
                                            </Popover>
                                          </>)}</div></div></li>))}</ul></ScrollArea>) 
                          : (<p className="text-center text-muted-foreground pt-12">No tasks scheduled for this day.</p>)}
                      </>) 
                  : (<p className="text-center text-muted-foreground pt-12">Select a date to see tasks.</p>)}
                </div>
              </div>
            </>
          );
      default: return null;
    }
  };

  const stepTitles = ["Define Your Plan", "AI Analyzing", "Your Study Plan & Calendar"];
  const stepDescriptions = [
    "Tell us what you want to study, your timeline, and commitment.",
    "Our AI is crafting your optimal schedule.",
    activePlan?.status === 'completed' ? "This plan is completed. Review it or create a new one." : activePlan?.status === 'archived' ? "This plan is archived. Review it or create a new one." : "Review and manage your AI-generated study plan."
  ];

  const completedTasksCount = activePlan?.tasks.filter(task => task.completed).length || 0;
  const totalTasksCount = activePlan?.tasks.length || 0;
  const progressPercentage = totalTasksCount > 0 ? (completedTasksCount / totalTasksCount) * 100 : 0;
  const canFinishPlan = activePlan?.status === 'active' && progressPercentage >= 80;

  return (
    <AppLayout>
      <div className="container mx-auto py-6 px-4 md:px-6">
        <Card className="w-full max-w-5xl mx-auto">
          <CardHeader>
            <CardTitle className="text-2xl text-center">{stepTitles[currentStep - 1]}</CardTitle>
            <CardDescription className="text-center">{stepDescriptions[currentStep - 1]}</CardDescription>
             {(currentStep === 1 || currentStep === 3) && (
                <div className="flex justify-center gap-2 pt-3">
                {[1,3].map(stepIndicator => (
                    <div key={stepIndicator}
                        className={`h-1.5 w-16 rounded-full transition-all duration-300 ease-in-out
                                    ${(currentStep === 1 && stepIndicator === 1) || (currentStep === 3 && stepIndicator === 3) ? 'bg-primary' : 'bg-muted'}`}
                    ></div>
                ))}</div>)}
          </CardHeader>
          <CardContent className={`space-y-6 min-h-[300px] flex flex-col ${currentStep === 3 ? '' : 'justify-center'}`}>
            {renderStepContent()}
          </CardContent>
          {currentStep === 3 && activePlan && activePlan.planDetails && (
            <CardFooter className="flex flex-col sm:flex-row gap-4 mt-6 pt-6 border-t">
                 <Button onClick={() => {
                    setPlannerFormInput(activePlan.planDetails);
                    setSelectedCalendarDate(activePlan.planDetails.startDate ? parseISO(activePlan.planDetails.startDate) : undefined);
                    setCurrentStep(1);
                 }} variant="outline" className="w-full sm:w-auto" disabled={activePlan.status === 'completed' || activePlan.status === 'archived'}>
                  <Edit3 className="mr-2 h-4 w-4" /> Modify Details
                </Button>
                {(activePlan.status === 'active') && (
                    <AdaptiveReplanModal
                        originalScheduleJSON={JSON.stringify(activePlan.tasks)}
                        planDetails={activePlan.planDetails}
                        onReplanSuccess={handleReplanSuccess}
                    />)}
                 {canFinishPlan && (
                    <Button onClick={handleMarkPlanAsCompleted} variant="default" className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white">
                    <CheckCircle className="mr-2 h-4 w-4" /> Mark Completed
                    </Button>)}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full sm:w-auto sm:ml-auto">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Plan
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>This will permanently delete the plan: "{activePlan.planDetails.subjects.substring(0,30)}...".</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeletePlan}>Confirm Delete</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent></AlertDialog>
              </CardFooter>)}
        </Card>
      </div>
      <TaskBreakdownModal isOpen={isBreakdownModalOpen} task={selectedTaskForBreakdown} onClose={() => { setIsBreakdownModalOpen(false); setSelectedTaskForBreakdown(null);}} onSave={handleSaveSubTasks} />
      <QuizModal task={selectedTaskForQuiz} subjectContext={activePlan?.planDetails?.subjects} isOpen={isQuizModalOpen} onClose={() => { setIsQuizModalOpen(false); setSelectedTaskForQuiz(null);}} onQuizComplete={handleSaveQuizScore} />
    </AppLayout>
  );
}

const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("relative overflow-y-auto", className)} {...props}>{children}</div>));
ScrollArea.displayName = "ScrollArea";
