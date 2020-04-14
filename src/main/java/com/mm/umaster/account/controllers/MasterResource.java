package com.mm.umaster.account.controllers;


import com.mm.umaster.account.error.ApiErrors;
import com.mm.umaster.account.models.Master;
import com.mm.umaster.account.models.User;
import com.mm.umaster.account.services.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.Errors;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController()
@RequestMapping(path = "/master")
public class MasterResource {

    @Autowired
    UserService userService;

    @PutMapping("/change-to-master")
    Master becomeMaster(@Valid @RequestBody Master master,
                        Errors errors,
                        @AuthenticationPrincipal User principal) {
        if (errors.hasErrors()) {
            throw ApiErrors.buildErrors(errors);
        }

        return userService.becomeUser(master, principal.getEmail());
    }
}
