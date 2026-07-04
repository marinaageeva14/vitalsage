package com.mm.umaster.account.controllers;


import com.mm.umaster.account.error.ApiErrors;
import com.mm.umaster.account.models.Master;
import com.mm.umaster.account.models.Skill;
import com.mm.umaster.account.models.User;
import com.mm.umaster.account.services.SkillService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.Errors;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

@RestController
@RequestMapping(path = "/skills")
public class SkillResource {

    @Autowired
    private SkillService skillService;

    @PostMapping()
    public Master addSkillToMaster(@Valid @RequestBody Skill skill,
                            Errors errors,
                            @AuthenticationPrincipal User principal) {
        if (errors.hasErrors()) {
            throw ApiErrors.buildErrors(errors);
        }
        return skillService.addSkill(skill, principal.getId());
    }

/*    @PutMapping("/${id}")
    public Skill editMasterSkill(@PathVariable long id,
                         @Valid @RequestBody Skill skill,
                         Errors errors,
                         @AuthenticationPrincipal User principal) {
        if (errors.hasErrors()) {
            throw ApiErrors.buildErrors(errors);
        }
        return skillService.editSkill(id, skill);
    }*/
/*
    @DeleteMapping("/${id}")
    void removeMasterSkill(@PathVariable Long id) {

    }*/
}
