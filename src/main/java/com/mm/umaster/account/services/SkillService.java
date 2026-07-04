package com.mm.umaster.account.services;

import com.mm.umaster.account.error.EntityNotFoundException;
import com.mm.umaster.account.models.Master;
import com.mm.umaster.account.models.Skill;
import com.mm.umaster.account.models.User;
import com.mm.umaster.account.repositories.MasterRepository;
import com.mm.umaster.account.repositories.SkillRepository;
import com.mm.umaster.account.repositories.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

@Service
public class SkillService {
    @Autowired
    private SkillRepository skillRepository;

    @Autowired
    private MasterRepository masterRepository;

    public Master addSkill(Skill skill, Long id) {
        Master master = masterRepository.findMasterByUser_Id(id);
        Set<Skill> skills = master.getSkills();
        skills.add(skill);
        return master;
    }

    public Skill editSkill(Long skillId, Skill skill, long userId) {
        Master master = masterRepository.findMasterByUser_Id(userId);

        Skill newSkill = skillRepository.findById(skillId)
                .orElseThrow(() -> new EntityNotFoundException("The skill"));
        return skillRepository.save(skill);
/*        Master master = masterRepository.findMasterByUser_Id(id);
        Set<Skill> skills = master.getSkills();
        skills.add(skill);
        return master;*/
    }
}
