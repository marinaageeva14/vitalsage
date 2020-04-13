package com.mm.umaster.account.controllers;

import com.mm.umaster.account.error.ApiErrors;
import com.mm.umaster.account.models.RoleType;
import com.mm.umaster.account.models.ShortUser;
import com.mm.umaster.account.services.UserService;
import lombok.Value;
import com.mm.umaster.account.models.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.Errors;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.security.Principal;
import java.util.List;

@RestController
@Value
public class UserResource {

    @Autowired
    UserService userService;

    @PostMapping("/registration")
    public User addUser(@Valid @RequestBody User user,
                        Errors errors) {
        if (errors.hasErrors()) {
            throw ApiErrors.buildErrors(errors);
        }

        return userService.createNewUserAccount(user);
    }

    @GetMapping("/users")
    public List<User> getAllUsers() {
        return userService.loadAllUsers();
    }

    @PatchMapping("/change-role/{roleType}")
    public User changeRole(@Valid @PathVariable RoleType roleType,
                                Principal principal) {
        return userService.changeRole(roleType, principal.getName());
    }
/*
    @PostMapping("/signin")
    public int signin(@Valid @RequestBody LoginForm loginRequest) {

        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        loginRequest.getEmail(),
                        loginRequest.getPassword()
                )
        );
        SecurityContextHolder.getContext().setAuthentication(authentication);

        String jwt = jwtProvider.generateJwtToken(authentication);
        return ResponseEntity.ok(new JwtResponse(jwt));
    }*/
}
