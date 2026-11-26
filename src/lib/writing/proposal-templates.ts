import type { ProposalSection, ProposalType } from "@/db/schema";

type TemplateSection = Omit<ProposalSection, "id">;

/** Starting outlines; Claude adapts them to the topic and the user can edit them. */
export const PROPOSAL_TEMPLATES: Record<ProposalType, { label: string; description: string; sections: TemplateSection[] }> = {
  thesis: {
    label: "Thesis or dissertation proposal",
    description: "For a master's or PhD proposal: the gap, your questions, and how you'll answer them.",
    sections: [
      { heading: "Introduction", guidance: "The topic, why it matters, and the problem in one or two paragraphs.", cites: true },
      { heading: "Literature review", guidance: "What existing research has found, where it agrees and disagrees, and the gap this study fills.", cites: true },
      { heading: "Research questions and objectives", guidance: "The research questions and the objectives that answer them, as a short list.", cites: false },
      { heading: "Theoretical framework", guidance: "The theory or concepts the study builds on, and how they shape the questions.", cites: true },
      { heading: "Methodology", guidance: "Design, participants or data, sampling, data collection, and analysis, with reasons for each choice.", cites: true },
      { heading: "Ethical considerations", guidance: "Consent, risks, data protection, and the approvals needed.", cites: false },
      { heading: "Timeline", guidance: "Phases with months and milestones, as a list.", cites: false },
      { heading: "Expected contribution", guidance: "What the findings would add to knowledge and practice, and the main limitations.", cites: true },
    ],
  },
  grant: {
    label: "Grant proposal",
    description: "For a funding application: significance, aims, approach, and feasibility.",
    sections: [
      { heading: "Summary", guidance: "The problem, the aims, the approach, and the expected impact in one paragraph.", cites: false },
      { heading: "Background and significance", guidance: "What is known, what is missing, and why filling the gap matters now.", cites: true },
      { heading: "Specific aims", guidance: "Two or three aims, each with its hypothesis or expected outcome, as a list.", cites: false },
      { heading: "Research approach", guidance: "For each aim: design, methods, analysis, and how success will be judged.", cites: true },
      { heading: "Risks and alternatives", guidance: "What could go wrong with each aim and the fallback plan.", cites: false },
      { heading: "Timeline and milestones", guidance: "Phases with months and deliverables, as a list.", cites: false },
      { heading: "Expected outcomes and impact", guidance: "Who benefits, how results will be shared, and longer-term impact.", cites: true },
      { heading: "Budget justification", guidance: "The main cost categories and why each is needed. Leave amounts in [brackets] to fill in.", cites: false },
    ],
  },
  protocol: {
    label: "Study protocol or research plan",
    description: "A step-by-step plan for running one study, the way an ethics board or supervisor expects it.",
    sections: [
      { heading: "Background and rationale", guidance: "The evidence so far and why this study is needed.", cites: true },
      { heading: "Objectives and hypotheses", guidance: "The primary and secondary objectives, and the hypotheses, as a list.", cites: false },
      { heading: "Study design", guidance: "The design and why it fits the objectives.", cites: true },
      { heading: "Participants and sampling", guidance: "Who takes part, inclusion and exclusion criteria, recruitment, and sample size reasoning.", cites: true },
      { heading: "Measures and data collection", guidance: "What is measured, with which instruments, and when.", cites: true },
      { heading: "Procedure", guidance: "What happens to participants or data, step by step.", cites: false },
      { heading: "Data analysis plan", guidance: "Analyses for each objective, and how missing data and confounders are handled.", cites: true },
      { heading: "Ethics and data management", guidance: "Consent, risks, data storage and sharing, and approvals.", cites: false },
      { heading: "Timeline", guidance: "Phases with months, as a list.", cites: false },
    ],
  },
};
